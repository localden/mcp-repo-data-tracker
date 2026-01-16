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

  // Initialize sparkline charts
  document.querySelectorAll('canvas.sparkline[data-sparkline]').forEach((canvas) => {
    try {
      const data = JSON.parse(canvas.dataset.sparkline);
      const color = canvas.dataset.color || CHART_COLORS.primary;

      new Chart(canvas, {
        type: 'line',
        data: {
          labels: data.map((_, i) => i),
          datasets: [{
            data: data,
            borderColor: color,
            backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.1)'),
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 0,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: { top: 4, bottom: 0, left: 0, right: 0 }
          },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
          scales: {
            x: { display: false },
            y: {
              display: false,
              grace: '10%'
            },
          },
          interaction: { enabled: false },
          animation: false,
        }
      });
    } catch (e) {
      console.error('Failed to initialize sparkline:', e);
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
