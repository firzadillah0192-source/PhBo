# Generated photo management

Admin: open `/admin`, select **Generations**, then select a job. Available results have a thumbnail, full preview, download and **Hapus foto**. Operator/superadmin access is required. Deletion is audited.

Customers: open `/account?tab=creations` (**My Creations**). The account API returns that account's jobs only. Result metadata, preview, download and deletion also check ownership on the server; another account receives 404 even if it knows a result ID. Guest results remain restricted to their original guest identity.

Deletion requires an explicit confirmation in the UI and `{"confirm": true}` in the API body:

- Customer: `DELETE /api/results/{result_id}`.
- Admin: `DELETE /api/admin/usage/generations/{job_id}/result` (admin authentication and CSRF protection).

Deletion removes the generated image file, records `results.deleted_at`, revokes existing share/claim links, and removes the result from the customer's creations. Job state, usage, provider and credit records remain for accounting; credits are not refunded. Uploaded source images and account deletion are outside this feature.

Schema: `backend/migrations/014_result_photo_deletion.sql`; the existing startup schema updater also adds the nullable column for existing installations.

Validation: `tests/test_result_photo_management.py` covers ownership, admin access, image thumbnails, confirmation, physical deletion, shared-link revocation, preserved accounting, expired files and path safety. `frontend/src/photoManagement.test.js` checks action visibility.
