import { LoginForm } from '@/components/auth/login-form';
import { ServiceWorkerRegistration } from '@/components/auth/service-worker-registration';

// Server component, prerendered as static HTML: the page chrome and the full sign-in form are in
// the HTML, so it paints before any JS runs. Only the form is a client island.
export default function Page() {
  return (
    <>
      <ServiceWorkerRegistration />
      <LoginForm />
    </>
  );
}
