Mwein Medical - Site + Simple Deploy

This repository contains the static website for Mwein Medical Services and a GitHub Actions workflow to deploy the site to an FTP(S)/SFTP host (useful for Safaricom Webhostng if they provide FTP/SFTP credentials).

Quick steps to get this on GitHub and deploy automatically:

1) Create a new GitHub repository (empty).
2) On your machine, from the project root run:

```powershell
git init
git add .
git commit -m "Initial site + deploy workflow"
git branch -M main
git remote add origin https://github.com/<YOUR-USERNAME>/<REPO>.git
git push -u origin main
```

3) In the GitHub repo, go to Settings > Secrets and variables > Actions and add these secrets:
- `FTP_HOST` — your host (e.g. ftp.example.com)
- `FTP_USERNAME`
- `FTP_PASSWORD`
- `FTP_REMOTE_DIR` — remote folder where files should be placed (e.g. `/public_html`)
- Optionally: if your host supports SFTP set `PROTOCOL` to `sftp` in the workflow (or change the `protocol` field).

4) On every push to `main`, GitHub Actions will deploy the repo to the remote via FTP/SFTP.

Notes about Safaricom Webhostng:
- Most shared hosts expose FTP or SFTP credentials in the control panel. If you're unsure, confirm with Safaricom support whether they provide FTP or SFTP and the web root path.
- If they only provide a control panel with a file manager, you can upload the repository ZIP from the GitHub release or use the panel to extract an uploaded ZIP.

If you want, I can:
- Initialize a local git repo and create the first commit for you here, or
- Help configure the workflow for SFTP if you confirm the protocol and remote path, or
- Create a simple `deploy.ps1` script for manual FTP upload.
