import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Library,
  LibraryKind,
  LibraryRow,
  Profile,
  ProfileRow,
  ProfileSpec,
  ResumeData,
  ResumePersonalInfo,
} from "../types";
import {
  emptyLibrary,
  newEntriesFromResume,
  parseLibrary,
  parsePerson,
  parseProfile,
  serializeItem,
  serializeProfile,
} from "../utils/library";

/** The user's saved personal info, library of entries and profiles, with save helpers. */
export function useDetails() {
  const [person, setPerson] = useState<ResumePersonalInfo>(() => parsePerson(null));
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [personJson, rows, profileRows] = await Promise.all([
        invoke<string | null>("get_person"),
        invoke<LibraryRow[]>("list_library_items"),
        invoke<ProfileRow[]>("list_profiles"),
      ]);
      setPerson(parsePerson(personJson));
      setLibrary(parseLibrary(rows));
      setProfiles(profileRows.map(parseProfile));
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePerson = useCallback(async (next: ResumePersonalInfo) => {
    await invoke("save_person", { data: JSON.stringify(next) });
    setPerson(next);
  }, []);

  /** Pass `id` null to add a new entry. */
  const saveItem = useCallback(
    async (kind: LibraryKind, id: string | null, fields: Record<string, unknown>) => {
      await invoke("save_library_item", { id, kind, data: JSON.stringify(fields) });
      await load();
    },
    [load]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      await invoke("delete_library_item", { id });
      await load();
    },
    [load]
  );

  const saveProfile = useCallback(
    async (id: string | null, name: string, spec: ProfileSpec) => {
      await invoke("save_profile", { id, name, data: serializeProfile(spec) });
      await load();
    },
    [load]
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      await invoke("delete_profile", { id });
      await load();
    },
    [load]
  );

  /** Adds what's in a resume to the library and fills in personal info if none is saved yet. */
  const importFromResume = useCallback(
    async (data: ResumeData): Promise<number> => {
      const entries = newEntriesFromResume(data, library);
      for (const { kind, item } of entries) {
        await invoke("save_library_item", { id: null, kind, data: serializeItem(item) });
      }
      if (!person.name && data.personal.name) {
        await invoke("save_person", { data: JSON.stringify({ ...data.personal }) });
      }
      await load();
      return entries.length;
    },
    [library, person.name, load]
  );

  return {
    person,
    library,
    profiles,
    loading,
    error,
    reload: load,
    savePerson,
    saveItem,
    deleteItem,
    saveProfile,
    deleteProfile,
    importFromResume,
  };
}
