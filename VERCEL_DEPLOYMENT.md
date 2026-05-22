# eBird Map - Vercel Deployment Guide

## 🚀 Quick Start

This guide will help you deploy your eBird map to Vercel so you can access it from your phone!

## Prerequisites

- ✅ GitHub account with your code pushed to a repository
- ✅ Vercel account
- ✅ Your eBird API key

## Deployment Steps

### 1. Push Your Code to GitHub

Make sure all files are committed and pushed:

```bash
git add .
git commit -m "Add Vercel deployment configuration"
git push origin master
```

### 2. Import Project to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Select your GitHub repository: `jjavaru/EBird-map`
4. Click "Import"

### 3. Configure Environment Variables

**CRITICAL STEP** - Set up your eBird API key:

1. In the import screen, expand "Environment Variables"
2. Add the following:
   - **Name:** `EBIRD_API_KEY`
   - **Environment:** Check all (Production, Preview, Development)
3. Click "Add"

### 4. Configure Build Settings

Vercel should auto-detect the settings, but verify:

- **Framework Preset:** Other
- **Build Command:** (leave empty or use: `echo 'No build needed'`)
- **Output Directory:** `.` (current directory)
- **Install Command:** `npm install`

### 5. Deploy!

1. Click "Deploy"
2. Wait 30-60 seconds for deployment to complete
3. You'll get a URL like: `https://ebird-map-yourname.vercel.app`

### 6. Access from Your Phone

1. Open your phone's browser
2. Visit your Vercel URL
3. Bookmark it or add to home screen for easy access!

## Important Notes

### Your Life List CSV

The API function tries to read `ebird_world_life_list.csv` from the project root. Make sure this file is:

- ✅ Committed to your GitHub repository
- ✅ Named exactly: `ebird_world_life_list.csv`

### Updating Your Location

To change the default location (currently Columbus, OH), you have two options:

**Option A:** Update the API function
Edit `api/birds.js` lines 30-32 to change the default coordinates:

```javascript
const lat = req.query.lat || "YOUR_LATITUDE";
const lng = req.query.lng || "YOUR_LONGITUDE";
```

**Option B:** Use URL parameters
Access the site with custom coordinates:

```
https://your-site.vercel.app/?lat=49.2888&lng=-123.1111
```

### API Key Security

Your eBird API key is stored as an environment variable on Vercel and is NOT exposed in your frontend code. ✅ Secure!

### Free Tier Limits

Vercel's free tier includes:

- Unlimited deployments
- Automatic HTTPS
- 100 GB bandwidth per month
- Serverless function executions (more than enough for personal use)

## Troubleshooting

### Error: "EBIRD_API_KEY not configured"

- Go to Vercel dashboard → Your project → Settings → Environment Variables
- Make sure `EBIRD_API_KEY` is set correctly
- Redeploy the project

### No birds showing up

- Check that `ebird_world_life_list.csv` exists in your repo
- Verify the CSV file format matches the expected columns
- Check browser console (F12) for errors

### Map not loading

- Verify you have internet connection (map tiles load from external CDN)
- Check browser console for JavaScript errors

## Updates & Redeployment

Every time you push to GitHub, Vercel automatically redeploys your site! 🎉

Just:

```bash
git add .
git commit -m "Your changes"
git push
```

Vercel will detect the push and redeploy in ~30 seconds.

## Local Development

To test locally before deploying:

```bash
npm install
npm run dev
```

Then open `bird-map.html` in your browser.

---

## File Structure

```
ebird/
├── index.html              # Main map page (updated for API)
├── bird-map.html          # Original static version (backup)
├── api/
│   └── birds.js           # Serverless function (eBird API logic)
├── ebird.mts              # Local development script
├── ebird_world_life_list.csv  # Your life list (must be in repo)
├── package.json           # Dependencies
├── vercel.json           # Vercel configuration
└── .gitignore            # Ignored files
```

## Next Steps

- 📱 Add site to your phone's home screen
- 🗺️ Share the URL with birding friends
- 🔄 Update your life list CSV and push to auto-redeploy
- ⚙️ Customize the default location for your area

Happy birding! 🐦
