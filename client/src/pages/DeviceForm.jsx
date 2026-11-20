import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Card, CONDITION_LABEL, ErrorText, Field, Input, Loading, Notice, Page, Select, Textarea, useLoad } from '../ui.jsx';

export default function DeviceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState({ state: 'idle', msg: '' });
  const cats = useLoad(() => api.get('/categories'), []);
  const existing = useLoad(() => (id ? api.get(`/devices/${id}`) : Promise.resolve(null)), [id]);

  // Optional: suggest the device type from a photo with a pretrained image model running in the browser.
  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHint({ state: 'loading', msg: 'Loading the AI image model. The first time can take a minute…' });
    try {
      const { suggestCategory } = await import('../photoHint.js');
      const r = await suggestCategory(file);
      const cat = r.category && cats.data?.find((c) => c.key === r.category);
      if (cat) {
        document.getElementById('category').value = String(cat.id);
        setHint({ state: 'done', msg: `AI suggestion: ${cat.label} (${Math.round(r.confidence * 100)}% confidence). Please check that it is right.` });
      } else {
        setHint({ state: 'done', msg: `The AI could not tell the device type from this photo (it saw: ${r.seen.join(', ')}). Please choose the type yourself.` });
      }
    } catch {
      setHint({ state: 'error', msg: 'The photo helper could not run, which usually means no internet connection. Please choose the type yourself.' });
    }
  };

  if (cats.loading || existing.loading) return <Loading />;
  const d = existing.data;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    try {
      const saved = id ? await api.put(`/devices/${id}`, body) : await api.post('/devices', body);
      navigate(`/devices/${saved.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Page title={id ? 'Edit device' : 'Add a device'}>
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <ErrorText error={error || cats.error || existing.error} />
          {!id && (
            <Field label="Suggest the type from a photo" hint="Optional. A pretrained AI image model runs in your browser and only suggests a type. The photo is not uploaded here.">
              <input type="file" accept="image/*" onChange={onPhoto} className="block w-full text-sm" />
            </Field>
          )}
          {hint.msg && <Notice kind={hint.state === 'error' ? 'warn' : 'info'}>{hint.msg}</Notice>}
          <Field label="Type of device">
            <Select id="category" name="category_id" required defaultValue={d?.category_id ?? ''}>
              <option value="" disabled>Choose one</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand"><Input name="brand" required maxLength={80} defaultValue={d?.brand} /></Field>
            <Field label="Model" hint="Optional."><Input name="model" maxLength={120} defaultValue={d?.model} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Age in years" hint="Your best guess is fine.">
              <Input name="age_years" type="number" step="0.5" min="0" max="60" required defaultValue={d?.age_years ?? ''} />
            </Field>
            <Field label="Condition">
              <Select name="condition" required defaultValue={d?.condition ?? ''}>
                <option value="" disabled>Choose one</option>
                {Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="What is wrong, if anything?" hint="For example: cracked screen, battery drains in an hour.">
            <Textarea name="description" maxLength={1000} defaultValue={d?.description} />
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy}>{busy ? 'Saving…' : 'Save device'}</Button>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
