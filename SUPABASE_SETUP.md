# Supabase setup

1. Copy `.env.example` to `.env` in the project root (beside `package.json`).
2. In Supabase, open the project Connect dialog and copy the project URL and publishable key.
3. Fill in these variables:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Only browser-safe keys belong here. Never use a secret or service_role key. VITE values are included in the browser build; `.env` is ignored by Git and is not served to visitors.

4. Open Supabase Dashboard > your project > SQL Editor > New query. Run the complete `supabase/schema.sql` file. The publishable key cannot create tables; this step must be performed through an authorized database admin session. This script is repeatable and does not delete patient records.
   It creates `doctor_profiles`, `patients`, `calls`, `call_receipts`, and the private Storage bucket `call-receipts`. In Table Editor, choose the `public` schema to see the four tables. In Storage, open `call-receipts` for PDFs.
5. Create the doctor's account in Authentication > Users. Patient rows are restricted to the signed-in doctor's user ID through Row Level Security.
6. Run `npm install` then `npm run dev`. Restart after changing `.env`. Run `npm run build` before deployment.

The portal reads and writes patient data only through Supabase after sign-in. Missing configuration shows a setup message and disables patient entry. It never loads old localStorage patient lists or seeds demo patients. Cloud errors are shown without falling back to demo data.

After signing in, update the doctor details and select Save Profile. An initial demonstration profile is saved on first sign-in. Add Patient writes directly to `patients`. Mark Called updates the patient and records a call and receipt in one database transaction. The portal then generates the PDF and uploads it to private Supabase Storage. If PDF upload fails, the call stays recorded and Download PDF retries the upload.

Mark Pending never deletes previous call records or PDFs. Each new completed call gets its own receipt and patient/provider snapshots. Editing a provider profile does not change earlier receipts. Download and Share retrieve the saved PDF. Share sends the actual file on supported devices, otherwise downloads it for attachment; no public patient links are created.

Auth users are listed in Authentication > Users, not the public Table Editor. Browser session tokens are managed by Supabase Auth; patient data in configured mode is stored in Supabase rather than localStorage. Existing local demo data is not automatically imported.

Validation requires running the schema first, signing in, saving a profile, adding a test patient, completing a call, and checking all four tables plus the Storage bucket. Live database setup has not been performed by the code build.

Reference: https://supabase.com/docs/guides/getting-started/api-keys
# Additional patient fields

For an existing database, run `supabase/patient-details.sql` in Supabase SQL Editor.
It adds Date (`scheduled_date`), Notes and message attempts without deleting records
or changing authentication/RLS. New databases can use the full `supabase/schema.sql`.

The displayed status is Pending, Left message, Left message twice or Done. Message
attempts remain pending; only Done records a completed call. Receipts preserve the
patient/doctor details at call completion, so later patient edits do not rewrite
historical receipts. Existing receipts remain unchanged.

## Sheet columns in the portal

Run the complete updated `supabase/patient-details.sql` again for an existing database.
It safely adds four nullable columns to `public.patients`: `date_of_birth` (date),
`facility` (text), `appointment_time` (text), and `contact_person_name` (text).
The sheet's Contact Details column continues to use the existing `phone` column.
Appointment Time is text so a source value such as `3:30` is preserved without
inventing AM/PM. Date of Birth is separate from the optional Appointment Date.

The CSV is unchanged. The list, import preview, add/edit forms and newly generated
receipts show the separate fields. Older imports with labeled details in Notes
are displayed using those labels until an edit saves them to the new columns.
The migration does not rewrite existing Notes, call snapshots, or saved PDFs.

No Edge Function change or deployment is required for this repository: the portal
imports and updates through Supabase's table API, not an Edge Function. The existing
`record_patient_call` database trigger snapshots `to_jsonb(new)`, which includes
the new columns automatically. Existing RLS policies continue to apply to the row.
Any separately maintained external Edge Function with an explicit field allowlist
would need these four keys added; its source is not part of this project.

This migration has been prepared locally; it must be run by a database admin in
Supabase SQL Editor before saving or importing the new fields in the live database.

The portal labels `contact_person_name` as Customer Person Name. Both Customer
Person Name and Contact Person Name CSV headers are accepted. Labeled appointment,
facility and contact metadata is moved out of displayed/imported Notes; person
names and phone numbers go into their separate fields. Ordinary notes are retained.
Existing records are cleaned for display and when opened for editing; saving an
edit persists the cleaned fields and Notes. Loading a queue does not rewrite
database records or historical PDFs. This cleanup needs no additional database
columns or Edge Function changes beyond the migration above.

The paste importer also accepts pipe-bordered text tables with bold cell markers
and Markdown alignment rows. The first patient row is retained, separators are
ignored, and empty columns keep their positions. Pasting creates a preview;
Import Patients saves the valid records after review. No CSV rewrite is needed.
