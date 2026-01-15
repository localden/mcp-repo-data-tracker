/**
 * Chart.js initialization for MCP Dashboard
 */

// Default chart colors
const CHART_COLORS = {
  primary: 'rgb(0, 102, 204)',
  primaryLight: 'rgba(0, 102, 204, 0.1)',
  success: 'rgb(40, 167, 69)',
  successLight: 'rgba(40, 167, 69, 0.1)',
  warning: 'rgb(255, 193, 7)',
  danger: 'rgb(220, 53, 69)',
  gray: 'rgb(108, 117, 125)',
  grayLight: 'rgba(108, 117, 125, 0.1)',
};

// Default chart options
const DEFAULT_OPTIONS = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        boxWidth: 12,
        padding: 16,
      },
    },
  },
};

// Initialize all charts on page load
document.addEventListener('DOMContentLoaded', () => {
  // Find all chart canvases with data attributes
  document.querySelectorAll('canvas[data-chart]').forEach((canvas) => {
    try {
      const config = JSON.parse(canvas.dataset.chart);
      new Chart(canvas, config);
    } catch (e) {
      console.error('Failed to initialize chart:', e);
    }
  });
});

// Utility function to format numbers
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Utility function to format hours as human-readable
function formatHours(hours) {
  if (hours < 1) {
    return Math.round(hours * 60) + 'm';
  }
  if (hours < 24) {
    return Math.round(hours) + 'h';
  }
  return Math.round(hours / 24) + 'd';
}
