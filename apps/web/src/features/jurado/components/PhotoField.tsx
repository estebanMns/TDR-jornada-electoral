import { useEffect, useState } from 'react';
import { preparePhoto, type PreparedPhoto } from '../photo/preparePhoto';

interface PhotoFieldProps {
  photo: PreparedPhoto | null;
  onChange: (photo: PreparedPhoto | null) => void;
}

export function PhotoField({ photo, onChange }: PhotoFieldProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await preparePhoto(file));
    } catch {
      setError('No se pudo procesar la foto. Intenta tomarla de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-3">
        {preview ? (
          <img src={preview} alt="Foto del acta" className="size-20 rounded-lg object-cover ring-1 ring-slate-200" />
        ) : (
          <div className="grid size-20 place-items-center rounded-lg bg-slate-100 text-3xl text-slate-400" aria-hidden>
            📷
          </div>
        )}
        <div className="flex-1">
          <p className="font-medium">Foto del acta E-14</p>
          <p className="text-sm text-slate-500">
            {busy ? 'Procesando…' : photo ? `${Math.round(photo.blob.size / 1024)} KB · lista` : 'Obligatoria'}
          </p>
          <label className="mt-2 inline-block cursor-pointer rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            {photo ? 'Tomar otra' : 'Tomar foto'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </label>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
