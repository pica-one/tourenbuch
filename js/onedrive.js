// Zugriff auf OneDrive über Microsoft Graph (wie GraphOneDriveApi.kt in der App).

const BASE = 'https://graph.microsoft.com/v1.0';
/** Stückgrösse muss ein Vielfaches von 320 KiB sein (Vorgabe von Microsoft): 16 x 320 KiB = 5 MiB. */
const CHUNK_SIZE = 16 * 320 * 1024;

export class OneDriveError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
/** Anmeldung abgelaufen. */
export class AuthError extends OneDriveError {}
/** Die Datei wurde inzwischen von einem anderen Gerät geändert (409/412). */
export class ConflictError extends OneDriveError {}
/** OneDrive gerade nicht erreichbar oder überlastet. */
export class BusyError extends OneDriveError {}

export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Graph-Zugriff mit einem Zugangsschlüssel (getToken liefert ihn). */
export function createOneDrive(getToken, fetchFn = (...a) => fetch(...a)) {
  async function call(url, options = {}) {
    const token = await getToken();
    let res;
    try {
      res = await fetchFn(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
    } catch {
      throw new BusyError('Keine Verbindung zu OneDrive.', 0);
    }
    if (res.ok) return res;
    throw await toError(res);
  }

  return {
    /** Liest eine Datei: { text, eTag } oder null, wenn es sie noch nicht gibt. */
    async readFile(path) {
      let item;
      try {
        item = await (await call(`${BASE}/me/drive/root:/${encodePath(path)}`)).json();
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
      const url = item['@microsoft.graph.downloadUrl'];
      if (!item.eTag || !url) throw new OneDriveError('OneDrive hat unvollständig geantwortet.', 0);
      // Die Download-Adresse ist vorab berechtigt – kein Zugangsschlüssel mitschicken
      let res;
      try {
        res = await fetchFn(url);
      } catch {
        throw new BusyError('Keine Verbindung zu OneDrive.', 0);
      }
      if (!res.ok) throw await toError(res);
      return { text: await res.text(), eTag: item.eTag };
    },

    /**
     * Schreibt eine kleine Datei. Mit ifMatch nur, wenn sie noch diese Version hat,
     * ohne ifMatch nur, wenn es sie noch nicht gibt. Sonst ConflictError.
     */
    async writeFile(path, text, ifMatch) {
      const conflict = ifMatch ? '' : '?@microsoft.graph.conflictBehavior=fail';
      const headers = { 'Content-Type': 'application/json' };
      if (ifMatch) headers['If-Match'] = ifMatch;
      const res = await call(`${BASE}/me/drive/root:/${encodePath(path)}:/content${conflict}`, { method: 'PUT', headers, body: text });
      return (await res.json()).eTag;
    },

    /**
     * Lädt eine Datei hoch (in Stücken, mit Fortschritt). Existiert der Name schon, bekommt die neue Datei
     * einen anderen Namen – es wird nie etwas überschrieben.
     * target: { folderId, name } (name darf "Topos/x.pdf" sein) oder { path } (ganzer Pfad, Ordner werden angelegt)
     * Ergebnis: { id, name, path, parentId }
     */
    async upload(target, file, onProgress = () => {}) {
      if (!file.size) throw new OneDriveError('Die Datei ist leer.', 0);
      const url = target.folderId
        ? `${BASE}/me/drive/items/${encodeURIComponent(target.folderId)}:/${encodePath(target.name)}:/createUploadSession`
        : `${BASE}/me/drive/root:/${encodePath(target.path)}:/createUploadSession`;
      const session = await (
        await call(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
        })
      ).json();
      const size = file.size;
      let offset = 0;
      try {
        return await sendChunks();
      } catch (e) {
        // Abgebrochen: Upload-Sitzung beenden, damit kein leerer Platzhalter (0 Byte) im Ordner bleibt
        fetchFn(session.uploadUrl, { method: 'DELETE' }).catch(() => {});
        throw e;
      }

      async function sendChunks() {
      while (offset < size) {
        const end = Math.min(offset + CHUNK_SIZE, size);
        let res;
        try {
          // Die Upload-Adresse ist vorab berechtigt – kein Zugangsschlüssel mitschicken
          res = await fetchFn(session.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${size}` },
            body: file.slice(offset, end),
          });
        } catch {
          throw new BusyError('Verbindung unterbrochen.', 0);
        }
        if (!res.ok) throw await toError(res);
        offset = end;
        onProgress(offset / size);
        if (res.status === 200 || res.status === 201) {
          const item = await res.json();
          const parentPath = decodeURIComponent((item.parentReference?.path ?? '').split('root:')[1] ?? '').replace(/^\/+/, '');
          return { id: item.id, name: item.name, path: parentPath ? `${parentPath}/${item.name}` : item.name, parentId: item.parentReference?.id ?? null };
        }
      }
      throw new OneDriveError('Upload unvollständig.', 0);
      }
    },

    /** Inhalt eines Ordners: [{ id, name, isFolder, mimeType, takenDateTime }]; null, wenn es ihn nicht gibt. */
    async listChildren(folderId) {
      const items = [];
      let next = `${BASE}/me/drive/items/${encodeURIComponent(folderId)}/children?$top=999&$select=id,name,size,folder,file,photo`;
      try {
        while (next) {
          const json = await (await call(next)).json();
          for (const v of json.value ?? []) {
            items.push({ id: v.id, name: v.name, size: v.size ?? null, isFolder: !!v.folder, mimeType: v.file?.mimeType ?? null, takenDateTime: v.photo?.takenDateTime ?? null });
          }
          next = json['@odata.nextLink'] ?? null;
        }
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
      return items;
    },

    /** Dateien eines Ordners mit Vorschaubildern: [{ id, name, thumb, large }] */
    async listWithThumbnails(folderId) {
      const items = [];
      // 400 px für das Raster (scharf auf dem Handy), "large" (800 px) als erstes Bild im Betrachter
      let next = `${BASE}/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200&$expand=thumbnails($select=c400x400,large)&$select=id,name,file`;
      while (next) {
        const json = await (await call(next)).json();
        for (const v of json.value ?? []) {
          if (!v.file) continue;
          const t = v.thumbnails?.[0];
          items.push({ id: v.id, name: v.name, thumb: t?.c400x400?.url ?? t?.large?.url ?? null, large: t?.large?.url ?? null });
        }
        next = json['@odata.nextLink'] ?? null;
      }
      return items;
    },

    /** Vorschaubild (Adresse) eines Fotos oder null. */
    async thumbnailUrl(itemId, size = 'c400x400') {
      try {
        // Über $expand (die Adresse ".../thumbnails/0/c400x400" beantwortet OneDrive mit einem Fehler)
        const res = await call(`${BASE}/me/drive/items/${encodeURIComponent(itemId)}?$select=id&$expand=thumbnails($select=${size},large)`);
        const t = (await res.json()).thumbnails?.[0];
        return t?.[size]?.url ?? t?.large?.url ?? t?.medium?.url ?? null;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },

    /** Adresse zum Herunterladen in Originalqualität oder null. */
    async downloadUrl(itemId) {
      try {
        const res = await call(`${BASE}/me/drive/items/${encodeURIComponent(itemId)}`);
        return (await res.json())['@microsoft.graph.downloadUrl'] ?? null;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },

    /** Link zum Öffnen im OneDrive-Web oder null. */
    async webUrl(itemId) {
      try {
        const res = await call(`${BASE}/me/drive/items/${encodeURIComponent(itemId)}?$select=webUrl`);
        return (await res.json()).webUrl ?? null;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },

    /** Kennung eines Ordners/einer Datei über den Pfad oder null. */
    async itemIdByPath(path) {
      try {
        const res = await call(`${BASE}/me/drive/root:/${encodePath(path)}?$select=id`);
        return (await res.json()).id ?? null;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },

    /** Link zum Öffnen eines Ordners über seinen Pfad oder null. */
    async webUrlByPath(path) {
      try {
        const res = await call(`${BASE}/me/drive/root:/${encodePath(path)}?$select=webUrl`);
        return (await res.json()).webUrl ?? null;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
  };
}

async function toError(res) {
  let code = '';
  try {
    code = (await res.json())?.error?.code ?? '';
  } catch {
    /* keine Fehlerangabe */
  }
  const s = res.status;
  if (s === 401) return new AuthError('Bitte neu anmelden.', s);
  if (s === 409 || s === 412) return new ConflictError(`Datei wurde inzwischen geändert (${s}).`, s);
  if (s === 404) return new OneDriveError('Nicht gefunden.', s);
  if (s === 507 || code === 'quotaLimitReached') return new OneDriveError('Dein OneDrive-Speicher ist voll.', s);
  if (s === 403) return new OneDriveError('OneDrive erlaubt diesen Zugriff nicht.', s);
  if (s === 429 || s >= 500) return new BusyError(`OneDrive ist gerade nicht erreichbar (${s}).`, s);
  return new OneDriveError(`OneDrive-Fehler ${s} ${code}`.trim(), s);
}
