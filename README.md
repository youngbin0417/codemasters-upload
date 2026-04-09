# GitHub Auto Saver

Chrome extension for `educodegenius.com` that saves submitted code to the signed-in user's `aivle-codemasters` repository.

## Build

```bash
GITHUB_CLIENT_ID=your_github_oauth_client_id npm run build
```

This creates a deployable extension in `dist/`.

## Load In Chrome

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Click `Load unpacked`
4. Select the `dist/` folder

Do not load the repository root directly. The GitHub client ID is injected only into the `dist/` build.
