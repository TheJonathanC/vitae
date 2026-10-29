import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import DetailsManager from "../DetailsManager";
import { invoke } from "@tauri-apps/api/tauri";
import { Document, LibraryRow, ProfileRow } from "../../types";

vi.mock("@tauri-apps/api/tauri", () => ({ invoke: vi.fn() }));

interface Store {
  person: string | null;
  rows: LibraryRow[];
  profiles: ProfileRow[];
}

/** An in-memory stand-in for the Rust commands. */
function mockBackend(store: Store) {
  let counter = 0;
  const now = "2026-01-01T00:00:00Z";
  (invoke as any).mockImplementation(async (cmd: string, args: any) => {
    switch (cmd) {
      case "get_person":
        return store.person;
      case "save_person":
        store.person = args.data;
        return;
      case "list_library_items":
        return store.rows;
      case "save_library_item": {
        const id = args.id ?? `item-${++counter}`;
        store.rows = [...store.rows.filter((r) => r.id !== id), { id, kind: args.kind, data: args.data, created_at: now, updated_at: now }];
        return store.rows.find((r) => r.id === id);
      }
      case "delete_library_item":
        store.rows = store.rows.filter((r) => r.id !== args.id);
        return;
      case "list_profiles":
        return store.profiles;
      case "save_profile": {
        const id = args.id ?? `profile-${++counter}`;
        store.profiles = [...store.profiles.filter((p) => p.id !== id), { id, name: args.name, data: args.data, created_at: now, updated_at: now }];
        return;
      }
      case "delete_profile":
        store.profiles = store.profiles.filter((p) => p.id !== args.id);
        return;
      default:
        throw new Error(`unexpected ${cmd}`);
    }
  });
}

const exp = (id: string, role: string, company: string): LibraryRow => ({
  id,
  kind: "experience",
  data: JSON.stringify({ role, company, startDate: "2022", endDate: "Present", bullets: ["Built things"] }),
  created_at: "",
  updated_at: "",
});

async function open(store: Store, documents: Document[] = []) {
  mockBackend(store);
  render(<DetailsManager documents={documents} onClose={vi.fn()} />);
  await screen.findByRole("tab", { name: "Personal" });
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
}

describe("DetailsManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves personal details that every resume shares", async () => {
    const store: Store = { person: null, rows: [], profiles: [] };
    await open(store);
    expect(screen.getByText(/Enter your details once/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByText("Save personal details"));
    expect(await screen.findByText(/Saved\. New resumes use these details/)).toBeInTheDocument();
    expect(JSON.parse(store.person!)).toMatchObject({ name: "Jane Doe", email: "jane@example.com" });
  });

  it("needs a name before personal details can be saved", async () => {
    await open({ person: null, rows: [], profiles: [] });
    expect(screen.getByText("Save personal details")).toBeDisabled();
  });

  it("adds an experience with one bullet per line", async () => {
    const store: Store = { person: null, rows: [], profiles: [] };
    await open(store);
    fireEvent.click(screen.getByRole("tab", { name: "Experience" }));
    fireEvent.click(screen.getByText("Add experience"));
    expect(screen.getByText("Save")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Backend Engineer" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("What you did"), { target: { value: "Cut latency 40%\n\n  Shipped billing API  \n" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Backend Engineer · Acme")).toBeInTheDocument();
    expect(JSON.parse(store.rows[0].data).bullets).toEqual(["Cut latency 40%", "Shipped billing API"]);
    expect(screen.getByText(/2 points/)).toBeInTheDocument();
  });

  it("edits an existing entry in place", async () => {
    const store: Store = { person: null, rows: [exp("e1", "Engineer", "Acme")], profiles: [] };
    await open(store);
    fireEvent.click(screen.getByRole("tab", { name: "Experience" }));
    fireEvent.click(screen.getByLabelText("Edit Engineer · Acme"));
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Staff Engineer" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Staff Engineer · Acme")).toBeInTheDocument();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].id).toBe("e1");
  });

  it("asks before deleting an entry", async () => {
    const store: Store = { person: null, rows: [exp("e1", "Engineer", "Acme")], profiles: [] };
    await open(store);
    fireEvent.click(screen.getByRole("tab", { name: "Experience" }));
    fireEvent.click(screen.getByLabelText("Delete Engineer · Acme"));
    expect(store.rows).toHaveLength(1);
    fireEvent.click(screen.getByText("Confirm delete"));
    await waitFor(() => expect(store.rows).toHaveLength(0));
  });

  it("builds a profile from chosen library entries", async () => {
    const store: Store = { person: null, rows: [exp("e1", "Engineer", "Acme"), exp("e2", "Intern", "Beta")], profiles: [] };
    await open(store);
    fireEvent.click(screen.getByRole("tab", { name: "Profiles" }));
    fireEvent.click(screen.getByText("New profile"));
    expect(screen.getByText("Save profile")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Backend" } });
    fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Backend Engineer" } });
    fireEvent.click(screen.getByLabelText("Intern · Beta"));
    fireEvent.click(screen.getByText("Save profile"));
    expect(await screen.findByText("Backend")).toBeInTheDocument();
    const saved = JSON.parse(store.profiles[0].data);
    expect(saved.headline).toBe("Backend Engineer");
    expect(saved.experienceIds).toEqual(["e1"]);
  });

  it("imports entries from an existing resume without duplicating", async () => {
    const store: Store = { person: null, rows: [exp("e1", "Engineer", "Acme")], profiles: [] };
    const resume = {
      personal: { name: "Jane Doe", email: "j@x.com" },
      experience: [
        { id: "a", role: "Engineer", company: "Acme", startDate: "2022", bullets: [] },
        { id: "b", role: "Intern", company: "Beta", startDate: "2020", bullets: ["t"] },
      ],
      education: [],
      projects: [],
      skills: [],
    };
    const doc: Document = { id: "d1", title: "Old resume", content: "", resume_data: JSON.stringify(resume), created_at: "", updated_at: "" };
    await open(store, [doc]);
    fireEvent.change(screen.getByLabelText("Import from a resume"), { target: { value: "d1" } });
    fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText("Saved 1 entry from that resume.")).toBeInTheDocument();
    expect(store.rows).toHaveLength(2);
    expect(JSON.parse(store.person!).name).toBe("Jane Doe");
    fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText("Everything in that resume was already saved.")).toBeInTheDocument();
  });

  it("shows backend errors instead of failing silently", async () => {
    const store: Store = { person: null, rows: [], profiles: [] };
    await open(store);
    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === "save_person") throw "That entry is too large to save.";
      return null;
    });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jane" } });
    fireEvent.click(screen.getByText("Save personal details"));
    expect(await screen.findByText("That entry is too large to save.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByText(/Saved\./)).not.toBeInTheDocument();
  });
});
