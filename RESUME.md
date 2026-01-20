## How to resume development (Mwein website + EMR)

This workspace snapshot preserves the current project state so you can close VS Code and return later.

Workspace root: C:\Users\USER\Downloads\mwein-medical-production-ready

Key items created/updated:
- Website updates: `index.html`, `emr.html`, `donations.html`, CSS/JS changes.  See the site files in the workspace root and `css/`, `js/`.
- Cloned repo: `mwein-git` (contains a copy and a commit of merged site files).
- Deploy helpers: `deploy/` (PowerShell + shell scripts to upload and unzip on cPanel).
- EMR dev scaffold: `emr-dev/` (Docker Compose, `.env`, import helpers and README).

Quick resume steps (recommended):

1. Open the workspace in VS Code:

   - File → Open Folder → select the folder above.

2. Confirm or push local commits (optional):

   - The repo copy is in `mwein-git`. To push changes to GitHub (if you want):

     ```powershell
     cd mwein-git
     git status
     git add .
     git commit -m "Work-in-progress: site + EMR scaffold"
     git push origin main
     ```

   - If pushing fails because of authentication, use a PAT or SSH key.

3. Run the EMR dev stack locally (on a machine with Docker):

   - Edit `emr-dev\.env` to set secure passwords.
   - Start the stack:

     ```powershell
     cd emr-dev
     docker compose pull
     docker compose up -d
     docker compose logs -f openmrs
     ```

   - Once OpenMRS is running, use the admin credentials from `.env` to login at `http://localhost:8080`.

4. Import CIEL concepts (optional):

   - Download a CIEL concepts package (JSON/CSV) and use `emr-dev\import_ciel.sh` or `import_ciel.ps1` to POST it to OpenMRS. Adjust endpoints based on installed import modules.

5. Deploy website changes again (if needed):

   - Use `deploy\deploy.ps1` or `deploy\deploy.sh` and your hosting credentials.

6. Notes & credentials:

   - You provided cPanel credentials earlier for deployment; rotate those after use.
   - Keep secrets out of source control; move any long-term secrets to environment variables or a secure store.

If you want, I can also push the full workspace snapshot to a private repo or keep it as `mwein-workspace-snapshot.zip` in the workspace root.
