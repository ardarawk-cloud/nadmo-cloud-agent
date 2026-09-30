# BIDIGI Core

Production service for BIDIGI · Bintang Digital Shop.

- Storefront keeps the existing BIDIGI interface through the NADMO VPS.
- /api/* is handled by the local BIDIGI backend.
- Digiflazz catalog, prepaid, postpaid, balance and callback support are server-side.
- iPaymu payment creation and verified callback support are server-side.
- Secrets are stored only in /etc/nadmo/bidigi.env on the VPS.
- SQLite state is stored in /var/lib/nadmo/bidigi.db.
- DIGIFLAZZ_TESTING defaults to true until production payment credentials are verified.

Never commit provider credentials, webhook secrets, or admin tokens.
