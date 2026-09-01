# Queki verification-email activation runbook

This runbook describes a later, separately approved production configuration change. Implementing the `/auth/verify` route does not change Firebase Auth, DNS, templates, or delivery configuration.

## Preconditions

1. The reviewed Hosting release containing `/auth/verify` is live at `https://queki.app/auth/verify`.
2. The route is tested while signed out and returns Queki UI rather than Login or a generic application route.
3. The existing authorized-domain allowlist remains unchanged, including `localhost`, Firebase Hosting, production, and preview domains.
4. A DNS administrator is available to add exactly the records Firebase generates.

## Custom sender domain

1. Open [Firebase Console](https://console.firebase.google.com/project/familyquest-beta-402cb/authentication/emails).
2. Select **Authentication → Templates**.
3. Open **Email address verification** with the edit control.
4. Select **Customize domain**.
5. Enter `queki.app`.
6. Firebase displays the authoritative DNS record table. Record every displayed row verbatim, including record type, host/name, value/target, and any priority field.
7. At the authoritative DNS provider for `queki.app`, add only those Firebase-generated records. They are expected to include TXT and CNAME records, but Firebase's displayed table is authoritative.
8. If Firebase supplies an SPF value, merge its mechanism into the existing single SPF TXT record. Do not publish a second `v=spf1` record.
9. Do not change MX records unless Firebase explicitly displays an MX requirement for this exact project and domain.
10. Return to the template editor and wait for **Verification complete**. Firebase documents that verification can take up to 24 hours.
11. Select **Apply custom domain** only after DNS verification succeeds and the Queki handler precondition is satisfied.

The current project reports custom-domain state `NOT_STARTED`; therefore exact TXT/CNAME host and value pairs do not exist yet and must not be guessed or committed.

## Verification template

In **Authentication → Templates → Email address verification**, set:

- Sender display name: `Queki`
- Sender local part: `no-reply`
- Expected resulting sender: `Queki <no-reply@queki.app>`
- Subject: `Verify your email for Queki`
- Custom action URL: `https://queki.app/auth/verify`
- Reply-to: use the reviewed Queki support address, or leave Firebase's non-reply behavior if no monitored address has been approved.

Use this reviewed HTML body, preserving Firebase's `%LINK%` placeholder:

```html
<div style="margin:0;background:#f7f7ff;padding:32px 16px;font-family:Arial,sans-serif;color:#111827">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;box-shadow:0 16px 50px rgba(79,70,229,.12)">
    <div style="font-size:22px;font-weight:800;color:#4f46e5">Queki</div>
    <h1 style="margin:24px 0 12px;font-size:28px;line-height:1.2">Verify your email</h1>
    <p style="margin:0 0 24px;line-height:1.6;color:#4b5563">Thanks for joining Queki. Verify your email to continue setting up or joining your family.</p>
    <a href="%LINK%" style="display:inline-block;border-radius:14px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px">Verify email</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b7280">If you didn't request this email, you can safely ignore it.</p>
  </div>
</div>
```

Do not use `%APP_NAME%` in the subject or body; the current Google Cloud project display name is not customer-facing Queki branding.

## Application-generated continuation

Keep the client `ActionCodeSettings` values unchanged:

- `url`: `https://queki.app/verify-email`
- `handleCodeInApp`: `false`

Firebase will add the continuation as an action-link parameter. `/auth/verify` ignores it for navigation and always uses the internal relative destination `/verify-email`.

## Activation verification

After separate approval and configuration:

1. Create one disposable password user through the production signup journey.
2. Confirm sender, subject, Queki HTML, and that the visible action link uses `queki.app`.
3. Open the link and confirm `/auth/verify` redeems the code.
4. Confirm Continue reaches `https://queki.app/verify-email` only.
5. In the original authenticated flow, confirm `reload()` and forced token refresh produce `email_verified=true` before any family authority.
6. Confirm create, adult invitation, legacy join, and no-intent flows retain their existing precedence and exactly-once behavior.
7. Retain QA records pending separate cleanup approval.

## Rollback

If branded email delivery or action links fail, revert the Firebase template custom action URL/domain through the template editor to the previously recorded Firebase defaults. Do not weaken application authority checks or deploy backend changes to compensate for email configuration.
