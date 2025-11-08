// Digest Generation Engine with Scheduling
class DigestEngine {
  constructor() {
    this.digests = [];
    this.timerEnabled = false;
    this.timerInterval = null;
    this.isGenerating = false;
    
    this.loadDigests();
    this.loadTimerState();
  }

  // ===== STORAGE =====

  loadDigests() {
    const stored = localStorage.getItem(CONFIG.STORAGE.DIGESTS);
    this.digests = stored ? JSON.parse(stored) : [];
    console.log('Digests loaded:', this.digests.length);
  }

  saveDigests() {
    localStorage.setItem(CONFIG.STORAGE.DIGESTS, JSON.stringify(this.digests));
  }

  loadTimerState() {
    const stored = localStorage.getItem(CONFIG.STORAGE.TIMER_STATE);
    this.timerEnabled = stored === 'true';
  }

  saveTimerState() {
    localStorage.setItem(CONFIG.STORAGE.TIMER_STATE, this.timerEnabled.toString());
  }

  // ===== TIMER CONTROL =====

  startTimer() {
    if (this.timerInterval) return;  // Already running
    
    this.timerEnabled = true;
    this.saveTimerState();
    
    console.log('Timer started - checking every minute for scheduled runs');
    
    // Check immediately
    this.checkSchedule();
    
    // Then check every minute
    this.timerInterval = setInterval(() => {
      this.checkSchedule();
    }, CONFIG.SCHEDULE.CHECK_INTERVAL_MS);
    
    // Update UI countdown every second
    this.startCountdown();
  }

  stopTimer() {
    this.timerEnabled = false;
    this.saveTimerState();
    
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    
    console.log('Timer stopped');
  }

  toggleTimer() {
    if (this.timerEnabled) {
      this.stopTimer();
    } else {
      this.startTimer();
    }
    return this.timerEnabled;
  }

  // ===== SCHEDULING LOGIC =====

  checkSchedule() {
    if (!this.timerEnabled) return;
    if (this.isGenerating) {
      console.log('Already generating digest, skipping check');
      return;
    }
    
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay();
    
    // Check if it's a weekday
    if (!CONFIG.SCHEDULE.DAYS.includes(currentDay)) {
      console.log('Not a weekday, skipping');
      return;
    }
    
    // Check if it's one of our scheduled hours at minute 00
    if (CONFIG.SCHEDULE.TIMES.includes(currentHour) && currentMinute === 0) {
      const runKey = this.getRunKey(now);
      const lastRun = localStorage.getItem(CONFIG.STORAGE.LAST_RUN);
      
      if (lastRun === runKey) {
        console.log('Already ran this cycle:', runKey);
        return;
      }
      
      console.log('Scheduled time detected! Generating digest...');
      this.generateDigest();
      localStorage.setItem(CONFIG.STORAGE.LAST_RUN, runKey);
    }
  }

  // Get unique key for this run (date + hour)
  getRunKey(date) {
    return `${date.toDateString()}-${date.getHours()}`;
  }

  // Calculate time until next scheduled run
  getNextRunTime() {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Find next scheduled time today
    const todayTimes = CONFIG.SCHEDULE.TIMES.filter(h => h > currentHour || (h === currentHour && currentMinute < 0));
    
    let nextRun = new Date(now);
    
    if (todayTimes.length > 0 && CONFIG.SCHEDULE.DAYS.includes(currentDay)) {
      // Next run is today
      nextRun.setHours(todayTimes[0], 0, 0, 0);
    } else {
      // Next run is tomorrow or next weekday
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(CONFIG.SCHEDULE.TIMES[0], 0, 0, 0);
      
      // Skip weekends
      while (!CONFIG.SCHEDULE.DAYS.includes(nextRun.getDay())) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
    }
    
    return nextRun;
  }

  // Get human-readable countdown
  getCountdown() {
    const now = new Date();
    const next = this.getNextRunTime();
    const diff = next - now;
    
    if (diff <= 0) return '00:00:00';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  // Update countdown display
  startCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    
    this.countdownInterval = setInterval(() => {
      if (this.timerEnabled) {
        const countdown = this.getCountdown();
        const countdownEl = document.getElementById('timerCountdown');
        if (countdownEl) {
          countdownEl.textContent = countdown;
        }
      }
    }, 1000);
  }

  // ===== DIGEST GENERATION =====

  async generateDigest() {
    // Check if portfolio exists
    if (!portfolioManager.hasPortfolio()) {
      console.error('Cannot generate digest: No portfolio saved');
      alert('Please save a portfolio first before generating digests.');
      return null;
    }
    
    if (this.isGenerating) {
      console.log('Already generating a digest');
      return null;
    }
    
    this.isGenerating = true;
    this.updateGeneratingStatus(true);
    
    try {
      console.log('Starting digest generation...');
      
      const portfolio = portfolioManager.getPortfolio();
      const response = await vertesiaAPI.generateDigest(portfolio);
      
      console.log('Vertesia response:', response);
      
      // For now, create a placeholder digest
      // In production, you'd poll for job completion and parse the result
      const digest = this.createPlaceholderDigest(portfolio);
      
      // Store digest
      this.digests.unshift(digest);  // Add to beginning
      this.saveDigests();
      
      console.log('Digest generated and saved:', digest);
      
      // Update UI
      if (window.timelineUI) {
        window.timelineUI.renderDigests();
      }
      
      return digest;
      
    } catch (error) {
      console.error('Failed to generate digest:', error);
      alert('Failed to generate digest. Check console for details.');
      return null;
      
    } finally {
      this.isGenerating = false;
      this.updateGeneratingStatus(false);
    }
  }

  // Create placeholder digest (temporary - until we parse real Vertesia response)
  createPlaceholderDigest(portfolio) {
    const now = new Date();
    const timeLabel = this.getTimeLabel(now.getHours());
    
    return {
      id: now.getTime().toString(),
      generatedAt: now.toISOString(),
      timeLabel: `${timeLabel} Digest • ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
      title: `${timeLabel} Portfolio Update - ${portfolio.holdings.length} Holdings Monitored`,
      items: portfolio.holdings.map(h => ({
        ticker: h.ticker,
        exposure: h.exposure,
        headline: `${h.ticker} monitoring active - checking for news...`,
        bullets: [
          'Real news will appear here once Vertesia integration is complete',
          'This is a placeholder to test the UI and scheduling system'
        ],
        sources: []
      }))
    };
  }

  getTimeLabel(hour) {
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 21) return 'Evening';
    return 'Night';
  }

  // Update UI during generation
  updateGeneratingStatus(isGenerating) {
    const btn = document.getElementById('generateNow');
    if (btn) {
      btn.disabled = isGenerating;
      btn.textContent = isGenerating ? 'Generating...' : 'Generate Digest Now';
    }
  }

  // ===== GETTERS =====

  getDigests() {
    return this.digests;
  }

  isTimerEnabled() {
    return this.timerEnabled;
  }
}

// Create global instance
const digestEngine = new DigestEngine();
