# Portfolio Pulse - Automated Portfolio News Monitoring

Autonomous news monitoring system that generates portfolio-specific news digests 3x daily (8am, 2pm, 8pm) on weekdays.

---

## 🎯 **What It Does**

1. **Portfolio Management** - Store your holdings with exposure percentages
2. **Automated Scheduling** - Runs at 8am, 2pm, 8pm Monday-Friday
3. **News Aggregation** - Searches last 7 days for material news on your holdings
4. **Smart Digests** - Generates exposure-weighted news summaries
5. **Timeline View** - Clean, expandable timeline of all generated digests

---

## 📁 **File Structure**

```
portfolio-pulse/
├── index.html              # Main application page
├── css/
│   └── styles.css         # All styling
├── js/
│   ├── config.js          # API configuration
│   ├── vertesia-api.js    # API wrapper
│   ├── portfolio.js       # Portfolio management
│   ├── digest-engine.js   # Scheduling & generation
│   ├── timeline.js        # UI rendering
│   └── app.js            # Main app logic
└── README.md
```

---

## 🚀 **Setup Instructions**

### **1. Deploy to Vercel**

```bash
# In your terminal, navigate to this folder
cd portfolio-pulse

# Initialize git (if not already)
git init
git add .
git commit -m "Initial Portfolio Pulse setup"

# Create GitHub repo and push
# (Replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/portfolio-pulse.git
git branch -M main
git push -u origin main

# Go to https://vercel.com/new
# Click "Import Git Repository"
# Select your portfolio-pulse repo
# Click "Deploy" (Vercel auto-detects settings)
```

### **2. Configure Vertesia Backend**

⚠️ **IMPORTANT**: You need to create a new interaction on Vertesia called `PortfolioPulse`

**Interaction Prompt Template:**
```
You are a portfolio news analyst. Given a list of stock holdings with exposure percentages, 
research the last 7 days of material news for each holding.

Focus on: earnings, regulatory changes, product launches, M&A, analyst ratings, executive moves.
Prioritize coverage based on portfolio exposure (larger positions get more detail).

Format as JSON:
{
  "digestTitle": "Brief title capturing main themes",
  "items": [
    {
      "ticker": "NVDA",
      "exposure": 25.6,
      "headline": "10-15 word headline",
      "bullets": ["Fact 1", "Fact 2", ...],
      "sources": [{"title": "...", "url": "..."}, ...]
    }
  ]
}
```

---

## 🧪 **Testing the System**

### **Step 1: Add Portfolio**

1. Open the application
2. In the left panel, enter holdings one per line:
   ```
   NVDA 77.067
   IONQ 150
   OKLO 20
   PLTR 60
   BCTI 75
   ```
3. Click "Save Portfolio"
4. Verify your portfolio appears with total value and exposure %

### **Step 2: Test Manual Generation**

1. Click "Generate Digest Now" (bypasses timer for testing)
2. Watch console for API calls and responses
3. Digest should appear in the timeline

### **Step 3: Enable Auto-Updates**

1. Click "Auto-updates: OFF" button (turns green)
2. Countdown timer starts showing time until next scheduled run
3. At 8am, 2pm, or 8pm (M-F), digest automatically generates

---

## ⚙️ **How It Works**

### **Timer System**

```javascript
// Checks every 60 seconds
setInterval(() => {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  
  // Monday-Friday at 8am, 2pm, 8pm
  if ([1,2,3,4,5].includes(day) && [8,14,20].includes(hour)) {
    generateDigest();
  }
}, 60000);
```

**Requirements:**
- Page must be open for timer to work
- Timer state saved to localStorage (survives refresh)
- Prevents duplicate runs using timestamp keys

### **Digest Generation Flow**

```
1. Timer triggers at scheduled time
2. Loads portfolio from localStorage
3. Calls Vertesia API with portfolio + 7-day lookback
4. Waits for async job completion
5. Parses JSON response
6. Stores digest with timestamp
7. Renders in timeline UI
```

### **Storage Schema**

**Portfolio:**
```json
{
  "holdings": [
    {
      "ticker": "NVDA",
      "quantity": 77.067,
      "currentPrice": 188.32,
      "currentValue": 14533.26,
      "exposure": 25.6
    }
  ],
  "totalValue": 56769.63,
  "lastUpdated": "2025-11-08T12:00:00Z"
}
```

**Digest:**
```json
{
  "id": "1699459200000",
  "generatedAt": "2025-11-08T20:00:00Z",
  "timeLabel": "Evening Digest • Nov 8, 8:00 PM",
  "title": "Tech Resilience Amid Market Volatility",
  "items": [...]
}
```

---

## 🔧 **Configuration Options**

Edit `js/config.js` to customize:

```javascript
SCHEDULE: {
  TIMES: [8, 14, 20],      // Change hours (24-hour format)
  DAYS: [1, 2, 3, 4, 5],   // Change days (0=Sun, 6=Sat)
  CHECK_INTERVAL_MS: 60000  // How often to check (60 seconds)
},

NEWS: {
  LOOKBACK_DAYS: 7,        // How far back to search
  MIN_EXPOSURE_FOR_PRIORITY: 10  // Threshold for priority coverage
}
```

---

## 🐛 **Known Limitations (MVP)**

1. **Timer requires open tab** - No true background execution without server
2. **Mock price data** - Uses hardcoded prices instead of real-time API
3. **Placeholder digests** - Until Vertesia integration complete, shows mock data
4. **No job status polling** - Doesn't check specific job completion status
5. **No digest comparison** - Doesn't highlight what changed since last digest

---

## 🚧 **Future Enhancements**

- [ ] Real-time price API integration (Alpha Vantage, IEX Cloud)
- [ ] Server-side scheduling (no open tab required)
- [ ] Delta detection (highlight new news vs previous digest)
- [ ] Email/SMS notifications for digests
- [ ] Multi-portfolio support
- [ ] File upload for statement parsing
- [ ] Export digests as PDF/email
- [ ] Historical digest search and filtering

---

## 📊 **Testing Checklist**

- [ ] Portfolio saves and displays correctly
- [ ] Manual "Generate Now" creates digest
- [ ] Timer countdown updates every second
- [ ] Timer triggers at correct times (8am, 2pm, 8pm)
- [ ] Digests expand/collapse in timeline
- [ ] localStorage persists across page refresh
- [ ] Auto-update toggle works
- [ ] Console shows API calls and responses

---

## 🆘 **Troubleshooting**

**Timer not firing:**
- Check browser console for errors
- Verify timer is enabled (button shows "ON")
- Make sure it's a weekday between 8am-8pm
- Check localStorage for last_run key conflicts

**No portfolio displaying:**
- Open browser console (F12)
- Check localStorage for `pulse_portfolio` key
- Verify format: `TICKER QUANTITY` (one per line)

**API errors:**
- Check Vertesia API key in `config.js`
- Verify environment ID is correct
- Check browser network tab for failed requests
- Confirm `PortfolioPulse` interaction exists on Vertesia

---

## 📝 **Next Steps**

1. Deploy to Vercel
2. Create `PortfolioPulse` interaction on Vertesia
3. Test manual generation
4. Enable auto-updates
5. Monitor first scheduled generation
6. Iterate on digest format based on results

---

Built with vanilla HTML/CSS/JS - no build tools required.
