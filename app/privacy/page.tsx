import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy – WiFi Near Me" };

export default function PrivacyPage() {
  const contact = process.env.CONTACT_EMAIL || "(contact address not set)";
  return (
    <main className="page">
      <p><a href="/">← Back to the map</a></p>
      <h1>Privacy</h1>
      <p>We collect as little as possible. You do not need an account.</p>

      <h2>What we store</h2>
      <ul>
        <li>The WiFi information that you submit, and its edit history.</li>
        <li>A cookie named <code>wnm_device</code> with a random ID. It makes sure that each browser counts once for votes and reports. It does not track you on other sites.</li>
        <li>A one-way hash of your IP address. We use it to stop spam and abuse. We do not store your IP address itself.</li>
      </ul>

      <h2>What we do not store</h2>
      <p>Your exact location stays in your browser. To find places, the browser sends the center of the map, rounded to about 100 meters. After you press “Use my location”, that center is near your position. We do not save it.</p>

      <h2>How long we keep data</h2>
      <p>Rate-limit records are deleted after about one day. Votes, reports, and entries stay while the entry exists.</p>

      <h2>Other services</h2>
      <ul>
        <li>Map tiles come from our map tile provider. Place data comes from OpenStreetMap.</li>
        <li>Place search uses a geocoding service. Our server sends it your search text.</li>
        <li>The “Directions in Google Maps” button opens Google Maps. Google gets data only after you click it.</li>
        <li>The site runs on Vercel and stores data with Supabase.</li>
      </ul>

      <h2>Contact</h2>
      <p>For questions, or to ask us to delete data, write to {contact}.</p>
    </main>
  );
}
