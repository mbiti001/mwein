# Mwein public website

Source for https://mweinmedical.co.ke/, hosted with PHP on cPanel. This is separate from the HMIS application in `platform/`.

## Current release

The public site includes service information, enquiries, blog publishing, moderated comments and visitor ratings. The animated homepage totals remain fixed at **6,255 registered patients** and **13,557 recorded encounters**, dated **27 September 2026**. Only confirmed records should change these totals; daily estimates must not be added. Visitor ratings are explicitly described as unverified visits.

## Layout

- `site/`: public document root, including assets and Apache rules.
- `tools/`: command-line setup, password reset and backup utilities. Keep these outside the public root.
- `tests/`: synthetic HTTP/database and image metadata tests.

## Runtime and configuration

The published site uses PHP 8.4 with SQLite3. Configuration, database, backups and uploaded media belong outside the public document root. `MWEIN_WEB_CONFIG` can specify the absolute private configuration path; otherwise the application uses `mwein-website-private/config.php` beside the document root. Never commit that configuration or production data.

For a new installation only, run `php tools/setup.php /absolute/private-directory https://your-domain.example admin@example.com`. The utility reads the password interactively and generates the secret. For an existing deployment, preserve its private configuration and data. Inspect `site/.htaccess` for domain-specific redirects before deploying to another domain.

## Testing

From the repository root:

```sh
PHP_BIN=/path/to/php python3 website-rewrite/tests/backend_test.py
php website-rewrite/tests/jpeg_metadata_test.php
node website-rewrite/tests/cookie_choices_test.cjs
```

Backend tests create temporary data, credentials and a local HTTP server; they do not submit production feedback. The release passed 26 backend test groups, 185 internal-link/anchor checks and live mobile navigation, ratings and comment-form checks. The seven final HTML pages were verified byte-for-byte after publication on 27 September 2026.

## Deployment

Back up the public root and private data before replacing files. Publish the contents of `site/` to the public document root using the existing cPanel deployment process. Do not upload this repository or the `tools/` and `tests/` directories to the public root. Preserve hosting-specific settings and verify the public pages and administrator access afterwards.

This Git snapshot contains website source and approved public assets. Local release archives, private assets, correspondence and database backups are intentionally excluded. Blog content, uploaded media, messages and ratings are runtime data and require separate protected backups. Git does not replace those backups.

Cookie controls offer Accept all, Reject optional and Necessary only. Analytics starts only after consent. Choices last 90 days and can be changed through Cookie settings in the footer; browser privacy signals override analytics consent. The consent checks cover defaults, persistence, expiry, withdrawal and request ordering.

## Confirmed totals editor

Sign in at `/manage/` and choose **Confirmed care totals**. Enter patients registered, encounters recorded, the date covered by those records, and a private source/correction note. Confirm that the figures were checked, then publish. Corrections can increase or decrease totals. The private append-only history keeps the previous figures, reporting dates, save times, notes and admin account; a version check rejects stale saves.

The homepage reads only totals and the reporting date from `/api/care-summary.php`. No scheduled increments or estimates are used. If JavaScript or the endpoint is unavailable, it retains the explicitly dated 27 September 2026 snapshot in the HTML. Private history is included in existing SQLite backups. The initial production figures stay at 6,255 and 13,557 until an administrator publishes newly confirmed records.
