import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms – WiFi Near Me" };

export default function TermsPage() {
  const contact = process.env.CONTACT_EMAIL || "(contact address not set)";
  return (
    <main className="page">
      <p><a href="/">← Back to the map</a></p>
      <h1>Terms of use</h1>
      <p>WiFi Near Me is a free map. Travelers share how to connect to WiFi at public places.</p>

      <h2>What you may share</h2>
      <ul>
        <li>Steps to connect, such as “ask the staff” or “open the login page”.</li>
        <li>A password ONLY if the place shows it in public, for example on a sign, a menu, or a receipt.</li>
        <li>Do not share private passwords, personal data, insults, advertising, or illegal content.</li>
      </ul>

      <h2>No guarantee</h2>
      <p>Information comes from users and can be old or wrong. Use it at your own risk. Public WiFi can be unsafe: do not send private data on networks you do not trust.</p>

      <h2>Removal</h2>
      <p>We can edit, hide, or remove any entry. If you own or manage a place and want an entry changed or removed, write to {contact}.</p>
    </main>
  );
}
