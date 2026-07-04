# ArukinSec Workspace Setup Instructions

Welcome to the ArukinSec project! Because this architecture relies on a strict separation of frontend and backend environments along with various security audits and scratch scripts, it requires a specific local directory structure. 

If you are an autonomous agent or a new developer setting up this project for the first time, please follow these instructions exactly to replicate the environment:

## 1. Create the Workspace Root
Create a directory in an appropriate work folder (e.g., `~/Work/websites/`) called `ArukinSec` to represent the organization. 
**CRITICAL:** This workspace root MUST NOT be a git repository. Do not initialize git in this root directory (`git init`), as doing so will cause nested git repository tracking errors.

## 2. Clone the Repositories
Inside the `ArukinSec` workspace root, clone the two main codebases. If you already have these repositories locally, simply move them into the workspace root.
- `git clone https://github.com/arukinSec/frontend.git`
- `git clone https://github.com/arukinSec/supabase.git`

## 3. Establish the Directory Structure
Create the following directories and files to match the standard workspace layout:
- **`audit/`**: Create this directory. All security audit reports, architectural reviews, and static analysis outputs must be stored here.
- **`scripts/`**: Create this directory. Any scratch scripts, data generation utilities, or one-off tasks should be stored here rather than polluting the source repositories.
- **`README.md`**: Create a README in the workspace root detailing this directory structure so anyone looking at the folder understands how the pieces fit together.

## 4. Setup Environment Variables
Copy the provided `.env.example` file in the workspace root to `.env`.
- Ask the user to provide the necessary secrets to fill out this `.env` file (e.g., Supabase URL, Google Client IDs, Razorpay keys). 
- This central `.env` file is used as a master reference and **MUST NEVER BE TRACKED BY GIT**. 
- You may also create individual `.env` (or `.env.local`) files inside the `frontend/` and `supabase/` directories as needed by the respective frameworks, using the central file as your source of truth.

---
By following this guide, you ensure the workspace remains clean, version control operates correctly on isolated sub-repositories, and sensitive credentials remain safely untracked on the local machine.
