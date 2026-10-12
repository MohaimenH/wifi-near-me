import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

describe("legal pages", () => {
  it("privacy page names the device cookie, IP hashing, third parties, and the contact", () => {
    const html = renderToStaticMarkup(PrivacyPage());
    for (const text of ["wnm_device", "hash", "OpenStreetMap", "Google Maps", "hello@example.com"]) {
      expect(html).toContain(text);
    }
  });

  it("terms page states the password rule and the takedown contact", () => {
    const html = renderToStaticMarkup(TermsPage());
    expect(html).toContain("shows it in public");
    expect(html).toContain("hello@example.com");
  });
});
