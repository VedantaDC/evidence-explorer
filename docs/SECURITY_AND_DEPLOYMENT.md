# Security, credentials, and deployment

This document records every credential boundary needed to operate the project.
It intentionally contains **names and setup instructions only**, never secret
values.

## Secret-handling policy

- Never commit a token, API key, password, private key, service-account JSON,
  or populated `.env` file.
- Never paste a temporary publishing credential into documentation, Git remote
  configuration, an issue, or a commit message.
- Use local environment variables for development and GitHub Actions secrets
  for automated jobs.
- If a credential may have been exposed, revoke or rotate it before continuing.
- `public/` is published to the internet. Nothing confidential belongs there.
- The current repository contains no required runtime secret.

## GitHub repository

- Repository: `VedantaDC/evidence-explorer`
- Remote URL: `git@github.com:VedantaDC/evidence-explorer.git`
- Default deployment branch: `main`
- Public site: <https://vedantadc.github.io/evidence-explorer/>

Local pushes use the operator's GitHub SSH configuration. The private SSH key
must remain in the user's SSH agent or operating-system keychain and must not be
copied into this project.

The Pages workflow uses:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

GitHub supplies its ephemeral `GITHUB_TOKEN` automatically. No custom Pages
deployment secret is currently required.

## ChatGPT Sites mirror

- Public site: <https://mnr-evidence-explorer.pk-s.chatgpt.site/>
- Project identity is stored in `.openai/hosting.json`.

Publishing requires a short-lived source-repository credential issued by the
Sites service. Obtain a fresh credential during the publishing session, pass it
only as a per-command authorization header, and allow it to expire. Do not save
it in Git configuration or `.env`.

The general release sequence is:

1. verify a clean Git working tree;
2. run the tests and build;
3. commit and push the exact source state;
4. obtain a temporary Sites source credential;
5. push that exact commit to the Sites source repository;
6. package the validated build;
7. save and deploy a Sites version;
8. verify the public URL and direct `/510k/{K_NUMBER}/` route.

## Optional DeepSeek semantic extraction

The external research pipeline can read:

```text
DEEPSEEK_API_KEY
```

The key is not present in this repository. The semantic extractor must never
print or store it. Model output is a proposal only and cannot set a claim to
`verified`.

For local use, provide the key in the shell environment or a private env file
outside the repository. For automation, create a GitHub Actions secret named
`DEEPSEEK_API_KEY` only if the workflow is deliberately enabled.

## Planned Google Document AI OCR

The publication-grade OCR/layout pilot has not run because Google credentials
are not configured. A future implementation is expected to use variables such
as:

```text
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_CLOUD_PROJECT
GOOGLE_DOCUMENT_AI_LOCATION
GOOGLE_DOCUMENT_AI_OCR_PROCESSOR_ID
GOOGLE_DOCUMENT_AI_LAYOUT_PROCESSOR_ID
```

`GOOGLE_APPLICATION_CREDENTIALS` should point to a local service-account JSON
file outside the repository. Never put that JSON file under the project tree.
For GitHub Actions, prefer workload identity federation; if a JSON credential is
unavoidable, store it as a protected Actions secret and write it only to a
temporary file during the job.

Before processing the corpus, set budget alerts and run only the 20-document
pilot. Store provider name, processor/version, processing date, and confidence
metadata with each page derivative.

## Private source documents

The public repository contains generated JSON transcriptions and evidence
artifacts, but not the complete local PDF corpus. The local research root is:

```text
/Users/ps/Desktop/Coding Projects/Research Project/MNR_510k_Research
```

Private or untracked inputs include:

- original FDA PDFs and detail-page captures;
- page images and OCR intermediates;
- the complete Python acquisition/extraction pipeline in the adjacent
  `scripts/` directory;
- the two study-guidance Word documents originally supplied from the user's
  Downloads directory;
- any future manufacturer manuals or labeling collected for gap filling.

Do not publish a document simply because it is locally available. Preserve the
FDA URL and retrieval date, and perform a document-level reuse check before
publishing full text.

## Release checklist

```text
[ ] No secret or credential appears in the diff
[ ] Generated evidence status is accurately described
[ ] npm test passes
[ ] npm run build:pages passes
[ ] Workbook and JSON check-only validation pass
[ ] GitHub Pages workflow succeeds
[ ] /evidence/ returns successfully
[ ] At least one /510k/{K_NUMBER}/ route returns successfully
[ ] ChatGPT Sites is republished if its mirror should change
[ ] No pending claim was added to verified Table 8.3
```

## Credential incident response

If a live secret is committed:

1. revoke it immediately;
2. issue a replacement;
3. remove the value from the current tree;
4. assess whether Git history must be rewritten;
5. review logs for unauthorized use;
6. document the incident without repeating the secret.

