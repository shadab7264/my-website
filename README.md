# Skyward Career and Placement Hub

A premium education consultancy website with a public lead-capture experience and a protected administration dashboard.

## Features

- Premium responsive Home, About Us and Contact Us pages
- Callback forms that collect prospective student leads
- Admin login with session authentication and CSRF-protected actions
- Admin dashboard for viewing enquiries and publishing or deleting homepage guidance posts
- Admin media uploads for publishing photos and playable videos with guidance posts
- Automatic Google Sheets delivery for new leads, with Admin resync for saved enquiries
- File-based data storage for easy local setup

## Run locally

```powershell
npm start
```

Open `http://localhost:3000`.

For local demonstration, the initial admin sign-in is:

```text
Email: admin@skywardeducation.com
Password: ChangeMe123!
```

## Configure for launch

Set secure credentials before making the site publicly available:

```powershell
$env:ADMIN_EMAIL="your-admin@email.com"
$env:ADMIN_PASSWORD="use-a-long-unique-password"
$env:SESSION_SECRET="use-a-long-random-secret"
npm start
```

Leads are saved to `data/leads.json`, which is ignored by Git to avoid accidentally committing personal contact data. Published posts are saved to `data/posts.json`.
Uploaded images and videos are saved to `data/uploads/` and removed automatically when their post is deleted.

## Connect Google Sheets For Leads

1. Create a new Google Sheet for your enquiries.
2. Copy its spreadsheet ID from the URL between `/d/` and `/edit`.
3. In Google Sheets, select **Extensions > Apps Script**.
4. Paste the contents of `integrations/google-sheets-app-script.gs`.
5. Replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with your sheet ID.
6. Replace `PASTE_THE_SAME_PRIVATE_SECRET_USED_ON_YOUR_WEBSITE` with a long private secret of your choice.
7. In Apps Script, select **Deploy > New deployment > Web app**.
8. Set **Execute as** to yourself and **Who has access** to anyone, then deploy.
9. Copy the Web App URL ending in `/exec`.
10. Start the website with that URL and the same secret:

```powershell
$env:GOOGLE_SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/your-deployment-id/exec"
$env:GOOGLE_SHEETS_SECRET="your-long-private-secret"
npm start
```

New leads will appear in the `Leads` tab of your Google Sheet. To send leads that were collected before connecting Google Sheets, log in to Admin and click **Sync Google Sheet**.

Names, email addresses, phone numbers and enquiry details are transmitted to the Google Sheet configured by you. Keep the sheet private and do not share the webhook secret.

## Publish an image or video

1. Sign in at `http://localhost:3000/admin`.
2. Under **Publish content**, add a title, category and description.
3. Choose an optional image or video file.
4. Click **Publish on Website**.

Accepted formats are JPG, PNG, WEBP, GIF, MP4 and WEBM, with a maximum file size of 50 MB per upload.

## Production note

This implementation is ideal for a small single-server deployment. For a public production launch, place the app behind HTTPS, store leads in an encrypted managed database, and connect an email or CRM notification service so every enquiry receives prompt attention.
