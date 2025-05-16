// ================================
// notification.js (ES6 module)
// ================================

export const NotificationSystem = {
  queue: [],
  isShowing: false,

  init() {
    if (document.getElementById('notification-style')) return;

    const styleTag = document.createElement('style');
    styleTag.id = 'notification-style';
    styleTag.innerHTML = `
      #notification-container {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 10px;
        width: 100%;
        max-width: 95vw;
        box-sizing: border-box;
        pointer-events: none;
      }

      .notification {
        padding: 12px 16px;
        border-radius: 6px;
        color: white;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        transform: translateY(20px);
        opacity: 0;
        animation: notificationIn 0.3s forwards;
        pointer-events: all;
        font-size: 14px;
      }

      .notification.success { background: #27ae60; }
      .notification.error   { background: #e74c3c; }
      .notification.warning { background: #f39c12; }
      .notification.info    { background: #3498db; }

      .notification .close-btn {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        margin-left: 10px;
      }

      .notification.fade-out {
        animation: notificationOut 0.3s forwards;
      }

      /* UNDO/REDO SPECIFIC STYLES */
      .undo-redo-notification {
        font-family: Arial, sans-serif;
        line-height: 1.4;
      }
      
      .undo-redo-notification strong {
        display: block;
        margin-bottom: 4px;
        font-size: 15px;
      }
      
      .undo-redo-notification .variant {
        font-weight: bold;
        margin-bottom: 6px;
      }
      
      .undo-redo-notification .change {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 4px 0;
      }
      
      .undo-redo-notification .label {
        min-width: 80px;
      }
      
      .undo-redo-notification .from {
        text-decoration: line-through;
        min-width: 40px;
        text-align: right;
      }
      
      .undo-redo-notification .to {
        font-weight: bold;
        min-width: 40px;
        text-align: right;
      }
      
      .undo-redo-notification .arrow {
        padding: 0 4px;
      }

      @keyframes notificationIn {
        to { transform: translateY(0); opacity: 1; }
      }

      @keyframes notificationOut {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(-20px); opacity: 0; }
      }

      @media (max-width: 600px) {
        .notification {
          font-size: 13px;
          padding: 10px 14px;
        }

        .undo-redo-notification .label {
          min-width: 70px;
        }
      }
    `;
    document.head.appendChild(styleTag);
  },

  show({ message, type = 'info', timeout = 3000, onClose } = {}) {
    this.queue.push({ message, type, timeout, onClose });
    if (!this.isShowing) this.processQueue();
  },

  processQueue() {
    if (this.queue.length === 0) {
      this.isShowing = false;
      return;
    }

    this.isShowing = true;
    const { message, type, timeout, onClose } = this.queue.shift();

    let container = document.getElementById('notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notification-container';
      document.body.appendChild(container);
    }

    const element = document.createElement('div');
    element.className = `notification ${type}`;
    element.innerHTML = `
      <span>${message}</span>
      <button class="close-btn" title="Dismiss">&times;</button>
    `;

    container.appendChild(element);

    const timer = setTimeout(() => {
      element.classList.add('fade-out');
      setTimeout(() => {
        element.remove();
        if (typeof onClose === 'function') onClose();
        this.processQueue();
      }, 300);
    }, timeout);

    element.querySelector('.close-btn').addEventListener('click', () => {
      clearTimeout(timer);
      element.classList.add('fade-out');
      setTimeout(() => {
        element.remove();
        if (typeof onClose === 'function') onClose();
        this.processQueue();
      }, 300);
    });
  }
};
