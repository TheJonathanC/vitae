//! Optional AI help with resume wording, using the user's own API key.
//!
//! Requests are made from the backend so the key never reaches the webview. The
//! pure parts (provider detection, model lists, prompts, response parsing, saved
//! settings) are separate from the network calls so they can be unit-tested.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::time::Duration;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1";
const OPENAI_URL: &str = "https://api.openai.com/v1";
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_KEY_LEN: usize = 300;
const MAX_JOB_CHARS: usize = 6_000;
const MAX_BULLET_CHARS: usize = 400;
const MAX_ITEMS: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    OpenAi,
    Gemini,
}

impl Provider {
    pub fn label(self) -> &'static str {
        match self {
            Provider::Anthropic => "Anthropic",
            Provider::OpenAi => "OpenAI",
            Provider::Gemini => "Google Gemini",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ModelInfo {
    pub id: String,
    pub created: i64,
    pub recommended: bool,
}

/// Keys go into HTTP headers, so keep them to printable ASCII without spaces.
pub fn clean_key(key: &str) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Enter an API key.".into());
    }
    if key.len() > MAX_KEY_LEN || !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err("That doesn't look like an API key.".into());
    }
    Ok(key.to_string())
}

pub fn detect_provider(key: &str) -> Option<Provider> {
    if key.starts_with("sk-ant-") {
        Some(Provider::Anthropic)
    } else if key.starts_with("sk-") {
        Some(Provider::OpenAi)
    } else if key.starts_with("AIza") {
        Some(Provider::Gemini)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const OPENAI_EXCLUDED: &[&str] = &[
    "instruct", "audio", "realtime", "transcribe", "tts", "image", "embedding", "search", "moderation",
    "whisper", "dall-e", "davinci", "babbage", "codex", "computer-use", "preview", "diarize",
];

fn is_openai_chat_model(id: &str) -> bool {
    let chat_family = id.starts_with("gpt-") || (id.starts_with('o') && id.chars().nth(1).map_or(false, |c| c.is_ascii_digit()));
    chat_family && !OPENAI_EXCLUDED.iter().any(|bad| id.contains(bad))
}

const GEMINI_EXCLUDED: &[&str] = &[
    "embedding", "tts", "image", "live", "audio", "imagen", "veo", "computer-use", "robotics", "aqa", "learnlm",
];

/// Gemini lists no creation dates, so newer versions are ranked by the number in the
/// name ("gemini-2.5-flash" -> 250), which is how Google numbers them.
fn gemini_rank(id: &str) -> i64 {
    id.strip_prefix("gemini-")
        .and_then(|rest| rest.split(|c: char| c != '.' && !c.is_ascii_digit()).next())
        .and_then(|version| version.parse::<f64>().ok())
        .map_or(0, |v| (v * 100.0).round() as i64)
}

fn gemini_models(body: &Value) -> Vec<ModelInfo> {
    body.get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|m| {
                    let id = m.get("name")?.as_str()?.strip_prefix("models/")?.to_string();
                    let can_write = m
                        .get("supportedGenerationMethods")
                        .and_then(Value::as_array)
                        .map_or(false, |methods| methods.iter().any(|x| x.as_str() == Some("generateContent")));
                    let usable = can_write && id.starts_with("gemini-") && !GEMINI_EXCLUDED.iter().any(|bad| id.contains(bad));
                    usable.then(|| ModelInfo { created: gemini_rank(&id), id, recommended: false })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_created(value: &Value) -> i64 {
    match value {
        Value::Number(n) => n.as_i64().unwrap_or(0),
        // Anthropic reports RFC 3339 timestamps; the date digits alone sort correctly.
        Value::String(s) => s.chars().filter(|c| c.is_ascii_digit()).take(14).collect::<String>().parse().unwrap_or(0),
        _ => 0,
    }
}

/// Models the key can use for writing, newest first, with one marked as the sensible
/// default: a balanced model rather than the biggest or the cheapest.
pub fn parse_models(provider: Provider, body: &Value) -> Vec<ModelInfo> {
    let mut models: Vec<ModelInfo> = if provider == Provider::Gemini {
        gemini_models(body)
    } else {
        body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|m| {
                    let id = m.get("id")?.as_str()?.to_string();
                    let usable = match provider {
                        Provider::Anthropic => id.starts_with("claude-"),
                        Provider::OpenAi => is_openai_chat_model(&id),
                        Provider::Gemini => false,
                    };
                    usable.then(|| ModelInfo {
                        created: parse_created(m.get("created").or_else(|| m.get("created_at")).unwrap_or(&Value::Null)),
                        id,
                        recommended: false,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
    };
    models.sort_by(|a, b| b.created.cmp(&a.created).then_with(|| a.id.cmp(&b.id)));
    models.dedup_by(|a, b| a.id == b.id);

    let preferred = match provider {
        Provider::Anthropic => ["sonnet", "haiku", "opus"].iter().find_map(|k| models.iter().position(|m| m.id.contains(k))),
        Provider::OpenAi => ["mini"].iter().find_map(|k| models.iter().position(|m| m.id.contains(k) && !m.id.contains("nano"))),
        // A stable "flash" model balances quality and cost; fall back to previews, then "pro".
        Provider::Gemini => {
            let stable = |m: &ModelInfo| !m.id.contains("preview") && !m.id.contains("exp");
            let flash = |m: &ModelInfo| m.id.contains("flash") && !m.id.contains("lite");
            models
                .iter()
                .position(|m| flash(m) && stable(m))
                .or_else(|| models.iter().position(flash))
                .or_else(|| models.iter().position(|m| m.id.contains("pro") && stable(m)))
        }
    };
    if let Some(index) = preferred.or(if models.is_empty() { None } else { Some(0) }) {
        models[index].recommended = true;
    }
    models
}

// ---------------------------------------------------------------------------
// Prompt and response
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RewriteItem {
    pub id: String,
    pub text: String,
}

pub const SYSTEM_PROMPT: &str = "You edit resume bullet points for a job applicant. Rewrite each bullet so it is clear and concise, starts with a strong past-tense verb (present tense for a current role), and uses the job's own wording only where the bullet already shows that skill or work.\n\nStrict rules:\n- Never add facts: no new numbers, tools, technologies, employers, scope or achievements that are not in the original bullet.\n- Keep every number and unit exactly as written.\n- Do not make claims the original does not support. If a bullet is unrelated to the job, improve its clarity only.\n- One line per bullet, under 220 characters, no first person, no markdown, no trailing period needed.\n- Keep the same meaning. If a bullet is already good, return it unchanged.\n\nReply with only JSON in this shape and nothing else: {\"bullets\":[{\"id\":\"<same id>\",\"text\":\"<rewritten bullet>\"}]}";

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

pub fn build_user_prompt(job_text: &str, role: Option<&str>, items: &[RewriteItem]) -> String {
    let mut prompt = String::new();
    if let Some(role) = role.map(str::trim).filter(|r| !r.is_empty()) {
        prompt.push_str(&format!("Target role: {}\n\n", clip(role, 100)));
    }
    let job = job_text.trim();
    if !job.is_empty() {
        prompt.push_str(&format!("Job description:\n\"\"\"\n{}\n\"\"\"\n\n", clip(job, MAX_JOB_CHARS)));
    }
    prompt.push_str("Bullets to rewrite:\n");
    for item in items {
        prompt.push_str(&format!("[{}] {}\n", item.id, clip(item.text.trim(), MAX_BULLET_CHARS)));
    }
    prompt
}

/// The first JSON object in model output, tolerating code fences or chatter around it.
pub fn extract_json(output: &str) -> Option<Value> {
    let start = output.find('{')?;
    let end = output.rfind('}')?;
    if end < start {
        return None;
    }
    serde_json::from_str(&output[start..=end]).ok()
}

/// Rewrites keyed by id. Unknown ids, empty text and oversized text are dropped, so a
/// confused model can't add entries or overwrite things it wasn't asked about.
pub fn parse_rewrites(output: &str, asked: &[RewriteItem]) -> Result<Vec<RewriteItem>, String> {
    let json = extract_json(output).ok_or("The AI's answer wasn't in the expected format. Try again.")?;
    let bullets = json
        .get("bullets")
        .and_then(Value::as_array)
        .ok_or("The AI's answer wasn't in the expected format. Try again.")?;
    let mut seen = std::collections::HashSet::new();
    let rewrites: Vec<RewriteItem> = bullets
        .iter()
        .filter_map(|b| {
            let id = b.get("id")?.as_str()?.trim_matches(|c| c == '[' || c == ']').to_string();
            let text = b.get("text")?.as_str()?.split_whitespace().collect::<Vec<_>>().join(" ");
            let known = asked.iter().any(|a| a.id == id);
            (known && !text.is_empty() && text.chars().count() <= MAX_BULLET_CHARS && seen.insert(id.clone())).then_some(RewriteItem { id, text })
        })
        .collect();
    if rewrites.is_empty() {
        return Err("The AI didn't return any usable rewrites. Try again.".into());
    }
    Ok(rewrites)
}

pub fn request_parts(provider: Provider, model: &str, system: &str, user: &str) -> (String, Value) {
    match provider {
        Provider::Anthropic => (
            format!("{}/messages", ANTHROPIC_URL),
            json!({
                "model": model,
                "max_tokens": 4096,
                "system": system,
                "messages": [{ "role": "user", "content": user }],
            }),
        ),
        Provider::Gemini => (
            format!("{}/models/{}:generateContent", GEMINI_URL, model),
            json!({
                "systemInstruction": { "parts": [{ "text": system }] },
                "contents": [{ "role": "user", "parts": [{ "text": user }] }],
            }),
        ),
        Provider::OpenAi => (
            format!("{}/chat/completions", OPENAI_URL),
            json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system },
                    { "role": "user", "content": user },
                ],
            }),
        ),
    }
}

pub fn response_text(provider: Provider, body: &Value) -> Option<String> {
    match provider {
        Provider::Anthropic => body
            .get("content")?
            .as_array()?
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")
            .into(),
        Provider::OpenAi => body.get("choices")?.get(0)?.get("message")?.get("content")?.as_str().map(str::to_string),
        Provider::Gemini => {
            let text: String = body
                .get("candidates")?
                .get(0)?
                .get("content")?
                .get("parts")?
                .as_array()?
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect();
            (!text.is_empty()).then_some(text)
        }
    }
}

// ---------------------------------------------------------------------------
// Saved settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AiSettings {
    pub provider: Option<Provider>,
    pub model: Option<String>,
    pub api_key: Option<String>,
}

/// What the webview may see: never the key itself.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AiSettingsView {
    pub has_key: bool,
    pub provider: Option<String>,
    pub provider_name: Option<String>,
    pub model: Option<String>,
}

impl AiSettings {
    pub fn view(&self) -> AiSettingsView {
        AiSettingsView {
            has_key: self.api_key.is_some(),
            provider: self.provider.map(|p| serde_json::to_value(p).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()),
            provider_name: self.provider.map(|p| p.label().to_string()),
            model: self.model.clone(),
        }
    }
}

pub fn load_settings(path: &Path) -> AiSettings {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save_settings(path: &Path, settings: &AiSettings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Couldn't save the settings: {}", e))?;
    }
    fs::write(path, text).map_err(|e| format!("Couldn't save the settings: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn clear_settings(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Couldn't remove the saved key: {}", e)),
    }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())
}

fn with_auth(provider: Provider, request: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    match provider {
        Provider::Anthropic => request.header("x-api-key", key).header("anthropic-version", ANTHROPIC_VERSION),
        Provider::OpenAi => request.bearer_auth(key),
        // In a header, not the URL, so the key can't end up in logs or error text.
        Provider::Gemini => request.header("x-goog-api-key", key),
    }
}

/// A message safe to show: it never contains the key or the provider's raw reply.
pub fn describe_failure(provider: Provider, status: Option<u16>, timed_out: bool) -> String {
    let name = provider.label();
    match status {
        Some(401) => format!("{} rejected the API key. Check that it's correct and active.", name),
        // Google answers a bad key with 400 rather than 401.
        Some(400) if provider == Provider::Gemini => format!("{} rejected the request. Check that the API key is correct and the model is available to it.", name),
        Some(403) => format!("{} says this key isn't allowed to do that.", name),
        Some(404) => format!("{} doesn't have that model. Pick another one in Settings.", name),
        Some(429) => format!("{} is rate limiting this key or the account is out of credit. Try again later.", name),
        Some(s) if s >= 500 => format!("{} is having problems right now. Try again in a moment.", name),
        Some(s) => format!("{} returned an error ({}).", name, s),
        None if timed_out => format!("{} took too long to answer. Try again.", name),
        None => format!("Couldn't reach {}. Check your internet connection.", name),
    }
}

async fn send_json(provider: Provider, request: reqwest::RequestBuilder) -> Result<Value, String> {
    let response = request.send().await.map_err(|e| describe_failure(provider, None, e.is_timeout()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(describe_failure(provider, Some(status.as_u16()), false));
    }
    response.json::<Value>().await.map_err(|_| format!("{} sent an answer Vitae couldn't read.", provider.label()))
}

pub async fn fetch_models(provider: Provider, key: &str) -> Result<Vec<ModelInfo>, String> {
    let url = match provider {
        Provider::Anthropic => format!("{}/models?limit=100", ANTHROPIC_URL),
        Provider::OpenAi => format!("{}/models", OPENAI_URL),
        Provider::Gemini => format!("{}/models?pageSize=200", GEMINI_URL),
    };
    let body = send_json(provider, with_auth(provider, client()?.get(url), key)).await?;
    let models = parse_models(provider, &body);
    if models.is_empty() {
        return Err(format!("This {} key doesn't have access to any models Vitae can use.", provider.label()));
    }
    Ok(models)
}

pub async fn rewrite(
    provider: Provider,
    key: &str,
    model: &str,
    job_text: &str,
    role: Option<&str>,
    items: &[RewriteItem],
) -> Result<Vec<RewriteItem>, String> {
    if provider == Provider::Gemini && !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return Err("That model name isn't valid. Pick another one in Settings.".into());
    }
    if items.is_empty() || items.len() > MAX_ITEMS {
        return Err(format!("Choose between 1 and {} bullets to improve.", MAX_ITEMS));
    }
    let (url, body) = request_parts(provider, model, SYSTEM_PROMPT, &build_user_prompt(job_text, role, items));
    let reply = send_json(provider, with_auth(provider, client()?.post(url).json(&body), key)).await?;
    let text = response_text(provider, &reply).ok_or("The AI sent an empty answer. Try again.")?;
    parse_rewrites(&text, items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, text: &str) -> RewriteItem {
        RewriteItem { id: id.into(), text: text.into() }
    }

    #[test]
    fn test_clean_key() {
        assert_eq!(clean_key("  sk-ant-abc123  ").unwrap(), "sk-ant-abc123");
        assert!(clean_key("").is_err());
        assert!(clean_key("   ").is_err());
        assert!(clean_key("sk-abc def").is_err(), "spaces would break the header");
        assert!(clean_key("sk-abc\nX-Evil: 1").is_err(), "newlines would inject headers");
        assert!(clean_key(&format!("sk-{}", "a".repeat(400))).is_err());
        assert!(clean_key("sk-é").is_err());
    }

    #[test]
    fn test_detect_provider() {
        assert_eq!(detect_provider("sk-ant-api03-xyz"), Some(Provider::Anthropic));
        assert_eq!(detect_provider("sk-proj-abc"), Some(Provider::OpenAi));
        assert_eq!(detect_provider("sk-abc"), Some(Provider::OpenAi));
        assert_eq!(detect_provider("AIzaSyA-example"), Some(Provider::Gemini));
        assert_eq!(detect_provider("ya29.oauth-token"), None);
        assert_eq!(detect_provider(""), None);
    }

    #[test]
    fn test_parse_anthropic_models() {
        let body = json!({"data": [
            {"id": "claude-haiku-5-5", "created_at": "2026-02-01T00:00:00Z", "type": "model"},
            {"id": "claude-sonnet-5-5", "created_at": "2026-03-01T00:00:00Z", "type": "model"},
            {"id": "claude-opus-5-5", "created_at": "2026-04-01T00:00:00Z", "type": "model"},
            {"id": "not-a-claude-model", "created_at": "2026-05-01T00:00:00Z"}
        ]});
        let models = parse_models(Provider::Anthropic, &body);
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], "newest first, claude only");
        let recommended: Vec<_> = models.iter().filter(|m| m.recommended).map(|m| m.id.as_str()).collect();
        assert_eq!(recommended, vec!["claude-sonnet-5-5"], "the balanced model is the default");
    }

    #[test]
    fn test_parse_openai_models_keeps_only_chat_models() {
        let body = json!({"data": [
            {"id": "gpt-5", "created": 300},
            {"id": "gpt-5-mini", "created": 310},
            {"id": "gpt-5-nano", "created": 320},
            {"id": "o3", "created": 200},
            {"id": "text-embedding-3-large", "created": 400},
            {"id": "whisper-1", "created": 100},
            {"id": "dall-e-3", "created": 100},
            {"id": "gpt-4o-audio-preview", "created": 500},
            {"id": "gpt-4o-realtime-preview", "created": 500},
            {"id": "omni-moderation-latest", "created": 100},
            {"id": "gpt-image-1", "created": 100}
        ]});
        let models = parse_models(Provider::OpenAi, &body);
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["gpt-5-nano", "gpt-5-mini", "gpt-5", "o3"]);
        assert_eq!(models.iter().find(|m| m.recommended).unwrap().id, "gpt-5-mini", "mini, not nano");
    }

    #[test]
    fn test_parse_gemini_models() {
        let can = json!(["generateContent", "countTokens"]);
        let body = json!({"models": [
            {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": can},
            {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": can},
            {"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": can},
            {"name": "models/gemini-3-flash-preview", "supportedGenerationMethods": can},
            {"name": "models/gemini-2.0-flash", "supportedGenerationMethods": can},
            {"name": "models/gemini-2.5-flash-image", "supportedGenerationMethods": can},
            {"name": "models/gemini-2.5-flash-preview-tts", "supportedGenerationMethods": can},
            {"name": "models/gemini-live-2.5-flash", "supportedGenerationMethods": can},
            {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"]},
            {"name": "models/gemma-3-27b-it", "supportedGenerationMethods": can},
            {"name": "models/imagen-4.0-generate-001", "supportedGenerationMethods": ["predict"]},
            {"name": "models/gemini-pro-vision", "supportedGenerationMethods": ["countTokens"]}
        ]});
        let models = parse_models(Provider::Gemini, &body);
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash"],
            "text models only, newest version first"
        );
        let recommended: Vec<_> = models.iter().filter(|m| m.recommended).map(|m| m.id.as_str()).collect();
        assert_eq!(recommended, vec!["gemini-2.5-flash"], "a stable flash model, not a preview or lite");
    }

    #[test]
    fn test_gemini_recommendation_fallbacks() {
        let can = json!(["generateContent"]);
        let only_preview = parse_models(Provider::Gemini, &json!({"models": [
            {"name": "models/gemini-3-flash-preview", "supportedGenerationMethods": can},
            {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": can}
        ]}));
        assert_eq!(only_preview.iter().find(|m| m.recommended).unwrap().id, "gemini-3-flash-preview");
        let only_pro = parse_models(Provider::Gemini, &json!({"models": [{"name": "models/gemini-2.5-pro", "supportedGenerationMethods": can}]}));
        assert_eq!(only_pro[0].id, "gemini-2.5-pro");
        assert!(only_pro[0].recommended);
        assert!(parse_models(Provider::Gemini, &json!({"models": "nope"})).is_empty());
        assert_eq!(gemini_rank("gemini-2.5-flash"), 250);
        assert_eq!(gemini_rank("gemini-3-pro-preview"), 300);
        assert_eq!(gemini_rank("something-else"), 0);
    }

    #[test]
    fn test_parse_models_edge_cases() {
        assert!(parse_models(Provider::Anthropic, &json!({})).is_empty());
        assert!(parse_models(Provider::OpenAi, &json!({"data": "nope"})).is_empty());
        // With no preferred family, the newest is recommended.
        let only = parse_models(Provider::Anthropic, &json!({"data": [{"id": "claude-x-1", "created_at": "2026-01-01T00:00:00Z"}]}));
        assert!(only[0].recommended);
        let dupes = parse_models(Provider::OpenAi, &json!({"data": [{"id": "gpt-5", "created": 1}, {"id": "gpt-5", "created": 1}]}));
        assert_eq!(dupes.len(), 1);
    }

    #[test]
    fn test_user_prompt_includes_job_role_and_bullets_within_limits() {
        let long_job = "x".repeat(MAX_JOB_CHARS + 500);
        let prompt = build_user_prompt(&long_job, Some("Backend Engineer"), &[item("a1", "Built APIs"), item("b2", &"y".repeat(900))]);
        assert!(prompt.contains("Target role: Backend Engineer"));
        assert!(prompt.contains("[a1] Built APIs"));
        assert!(prompt.matches('x').count() == MAX_JOB_CHARS, "the job text is clipped");
        assert!(prompt.matches('y').count() == MAX_BULLET_CHARS, "each bullet is clipped");
        let bare = build_user_prompt("", None, &[item("a1", "t")]);
        assert!(!bare.contains("Job description") && !bare.contains("Target role"));
    }

    #[test]
    fn test_gemini_model_names_cannot_break_out_of_the_url_path() {
        let items = [item("a", "text")];
        for bad in ["gemini/../x", "gemini-2.5-flash:evil", "gem ini", "a?b=c"] {
            // Rejected before any request is made.
            let result = tauri::async_runtime::block_on(rewrite(Provider::Gemini, "AIza-key", bad, "", None, &items));
            assert_eq!(result.unwrap_err(), "That model name isn't valid. Pick another one in Settings.", "{}", bad);
        }
    }

    #[test]
    fn test_system_prompt_forbids_inventing_facts() {
        assert!(SYSTEM_PROMPT.contains("Never add facts"));
        assert!(SYSTEM_PROMPT.contains("Keep every number"));
        assert!(SYSTEM_PROMPT.contains("\"bullets\""));
    }

    #[test]
    fn test_extract_json_tolerates_fences_and_chatter() {
        let fenced = "Sure!\n```json\n{\"bullets\":[{\"id\":\"a\",\"text\":\"x\"}]}\n```\nHope that helps.";
        assert!(extract_json(fenced).is_some());
        assert!(extract_json("no json here").is_none());
        assert!(extract_json("} backwards {").is_none());
    }

    #[test]
    fn test_parse_rewrites_keeps_only_valid_answers_for_asked_ids() {
        let asked = [item("a", "one"), item("b", "two")];
        let output = r#"```json
{"bullets":[
  {"id":"a","text":"  Cut latency 40%\n by caching  "},
  {"id":"[b]","text":"Refined two"},
  {"id":"zzz","text":"not asked for"},
  {"id":"a","text":"duplicate"},
  {"id":"b","text":""}
]}
```"#;
        let rewrites = parse_rewrites(output, &asked).unwrap();
        assert_eq!(rewrites, vec![item("a", "Cut latency 40% by caching"), item("b", "Refined two")]);
    }

    #[test]
    fn test_parse_rewrites_rejects_bad_output() {
        let asked = [item("a", "one")];
        assert!(parse_rewrites("I can't help with that", &asked).is_err());
        assert!(parse_rewrites(r#"{"nope":1}"#, &asked).is_err());
        assert!(parse_rewrites(r#"{"bullets":[{"id":"zzz","text":"x"}]}"#, &asked).is_err());
        let huge = format!(r#"{{"bullets":[{{"id":"a","text":"{}"}}]}}"#, "w".repeat(MAX_BULLET_CHARS + 1));
        assert!(parse_rewrites(&huge, &asked).is_err(), "oversized text is dropped");
    }

    #[test]
    fn test_request_parts_for_each_provider() {
        let (url, body) = request_parts(Provider::Anthropic, "claude-x", "SYS", "USER");
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert_eq!(body["system"], "SYS");
        assert_eq!(body["messages"][0]["content"], "USER");
        assert!(body["max_tokens"].as_i64().unwrap() > 0);

        let (url, body) = request_parts(Provider::OpenAi, "gpt-x", "SYS", "USER");
        assert_eq!(url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(body["messages"][0], json!({"role": "system", "content": "SYS"}));
        assert_eq!(body["messages"][1]["role"], "user");
        assert!(body.get("temperature").is_none(), "newer OpenAI models reject custom temperatures");

        let (url, body) = request_parts(Provider::Gemini, "gemini-2.5-flash", "SYS", "USER");
        assert_eq!(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "SYS");
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(body["contents"][0]["parts"][0]["text"], "USER");
        assert!(!url.contains("key="), "the key goes in a header, never the URL");
    }

    #[test]
    fn test_response_text_for_each_provider() {
        let anthropic = json!({"content": [{"type": "text", "text": "Hello "}, {"type": "text", "text": "world"}]});
        assert_eq!(response_text(Provider::Anthropic, &anthropic).unwrap(), "Hello world");
        let openai = json!({"choices": [{"message": {"content": "Hi there"}}]});
        assert_eq!(response_text(Provider::OpenAi, &openai).unwrap(), "Hi there");
        let gemini = json!({"candidates": [{"content": {"parts": [{"text": "Hello "}, {"text": "there"}]}, "finishReason": "STOP"}]});
        assert_eq!(response_text(Provider::Gemini, &gemini).unwrap(), "Hello there");
        let blocked = json!({"candidates": [{"finishReason": "SAFETY"}], "promptFeedback": {"blockReason": "SAFETY"}});
        assert_eq!(response_text(Provider::Gemini, &blocked), None);
        assert_eq!(response_text(Provider::Gemini, &json!({"candidates": [{"content": {"parts": []}}]})), None);
        assert_eq!(response_text(Provider::OpenAi, &json!({})), None);
        assert_eq!(response_text(Provider::Anthropic, &json!({"content": "x"})), None);
    }

    #[test]
    fn test_failure_messages_never_expose_the_key_and_say_what_to_do() {
        for status in [Some(401), Some(403), Some(404), Some(429), Some(500), Some(418), None] {
            let message = describe_failure(Provider::Anthropic, status, false);
            assert!(!message.contains("sk-"), "{}", message);
            assert!(message.contains("Anthropic"));
        }
        assert!(describe_failure(Provider::OpenAi, Some(401), false).contains("rejected the API key"));
        assert!(describe_failure(Provider::Gemini, Some(400), false).contains("API key is correct"));
        assert!(describe_failure(Provider::Anthropic, Some(400), false).contains("returned an error (400)"));
        assert!(describe_failure(Provider::Gemini, Some(429), false).contains("Google Gemini"));
        assert!(describe_failure(Provider::OpenAi, Some(429), false).contains("credit"));
        assert!(describe_failure(Provider::OpenAi, None, true).contains("too long"));
        assert!(describe_failure(Provider::OpenAi, None, false).contains("internet"));
    }

    fn temp_file(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("vitae-ai-{}-{}.json", name, std::process::id()))
    }

    #[test]
    fn test_settings_round_trip_and_the_view_hides_the_key() {
        let path = temp_file("settings");
        let _ = fs::remove_file(&path);
        assert_eq!(load_settings(&path), AiSettings::default());
        assert!(!load_settings(&path).view().has_key);

        let settings = AiSettings { provider: Some(Provider::Anthropic), model: Some("claude-sonnet-5-5".into()), api_key: Some("sk-ant-secret".into()) };
        save_settings(&path, &settings).unwrap();
        assert_eq!(load_settings(&path), settings);

        let view = settings.view();
        let gemini = AiSettings { provider: Some(Provider::Gemini), model: Some("gemini-2.5-flash".into()), api_key: Some("AIza-secret".into()) };
        assert_eq!(gemini.view().provider.as_deref(), Some("gemini"));
        assert_eq!(gemini.view().provider_name.as_deref(), Some("Google Gemini"));
        assert_eq!(view, AiSettingsView { has_key: true, provider: Some("anthropic".into()), provider_name: Some("Anthropic".into()), model: Some("claude-sonnet-5-5".into()) });
        assert!(!serde_json::to_string(&view).unwrap().contains("secret"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600, "only the owner can read the key");
        }
        clear_settings(&path).unwrap();
        assert!(!path.exists());
        clear_settings(&path).unwrap();
    }

    #[test]
    fn test_corrupt_settings_fall_back_to_empty() {
        let path = temp_file("corrupt");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(load_settings(&path), AiSettings::default());
        let _ = fs::remove_file(&path);
    }
}
