import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Button, Card, ErrorText, Field, Input, Notice, Select } from '../ui.jsx';

const home = (u) => (u.role === 'partner' ? '/my-locations' : u.role === 'admin' ? '/admin' : '/devices');

function useSubmit(fn) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try { await fn(new FormData(e.target)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return { error, busy, submit };
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from;
  const { error, busy, submit } = useSubmit(async (f) => {
    try {
      const user = await login(f.get('email'), f.get('password'));
      navigate(from || home(user), { replace: true });
    } catch (err) {
      if (err.data?.needsVerification) return navigate('/verify', { state: { email: err.data.email } });
      throw err;
    }
  });
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Card>
        <h1 className="mb-4 text-2xl font-bold">Sign in</h1>
        <form onSubmit={submit} className="space-y-4">
          <ErrorText error={error} />
          <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
          <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
          <Button disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <p className="mt-4 text-sm text-muted">New here? <Link className="underline" to="/register">Create an account</Link></p>
      </Card>
    </main>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { error, busy, submit } = useSubmit(async (f) => {
    const r = await register({ name: f.get('name'), email: f.get('email'), password: f.get('password'), role: f.get('role') });
    if (r.verificationRequired) return navigate('/verify', { state: { email: r.email, demoCode: r.demoCode } });
    navigate(home(r), { replace: true });
  });
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Card>
        <h1 className="mb-4 text-2xl font-bold">Create an account</h1>
        <form onSubmit={submit} className="space-y-4">
          <ErrorText error={error} />
          <Field label="Name"><Input name="name" autoComplete="name" required maxLength={100} /></Field>
          <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
          <Field label="Password" hint="At least 8 characters."><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
          <Field label="I am" hint="Partners list their shop or collection point. Listings are checked by an administrator before they appear publicly.">
            <Select name="role" defaultValue="user">
              <option value="user">A device owner</option>
              <option value="partner">A repair or recycling partner</option>
            </Select>
          </Field>
          <Button disabled={busy} className="w-full">{busy ? 'Creating…' : 'Create account'}</Button>
        </form>
        <p className="mt-4 text-sm text-muted">Already registered? <Link className="underline" to="/login">Sign in</Link></p>
      </Card>
    </main>
  );
}

export function Verify() {
  const { verifyEmail, resendCode } = useAuth();
  const navigate = useNavigate();
  const state = useLocation().state || {};
  const [demoCode, setDemoCode] = useState(state.demoCode || '');
  const [info, setInfo] = useState('');
  const [resendError, setResendError] = useState('');
  const email = state.email;
  const { error, busy, submit } = useSubmit(async (f) => {
    const user = await verifyEmail(email, String(f.get('code')).trim());
    navigate(home(user), { replace: true });
  });
  if (!email) {
    return <main className="mx-auto max-w-md px-4 py-10"><Card>Start from <Link className="underline" to="/register">Create an account</Link> or <Link className="underline" to="/login">Sign in</Link>.</Card></main>;
  }
  const resend = async () => {
    setInfo(''); setResendError('');
    try {
      const r = await resendCode(email);
      if (r.demoCode) setDemoCode(r.demoCode);
      setInfo('A new code was sent.');
    } catch (err) { setResendError(err.message); }
  };
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Card>
        <h1 className="mb-2 text-2xl font-bold">Check your email</h1>
        <p className="mb-4 text-sm text-muted">We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes. Look in spam if you do not see it.</p>
        {demoCode && (
          <div className="mb-4">
            <Notice kind="warn">Demo mode: email sending is not set up on this server, so your code is shown here: <strong className="text-lg tracking-widest">{demoCode}</strong></Notice>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <ErrorText error={error} />
          <Field label="Verification code">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
          </Field>
          <Button disabled={busy} className="w-full">{busy ? 'Checking…' : 'Verify and continue'}</Button>
        </form>
        <div className="mt-4 text-sm">
          <ErrorText error={resendError} />
          {info && <p className="text-board-dark" role="status">{info}</p>}
          <button type="button" onClick={resend} className="underline">Send a new code</button>
        </div>
      </Card>
    </main>
  );
}
