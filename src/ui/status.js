const statusEl = document.getElementById('status');
const statusWrapper = statusEl ? statusEl.parentElement : null;

const statusState = {
  visible: false,
  text: ''
};

export function showStatus(text) {
  if (!statusEl || !statusWrapper) return;

  // 同じテキストなら何もしない
  if (statusState.visible && statusState.text === text) return;

  statusState.visible = true;
  statusState.text = text;

  statusWrapper.classList.remove('hidden');
  statusEl.textContent = text;
}

export function hideStatus() {
  if (!statusEl || !statusWrapper) return;
  if (!statusState.visible) return;

  statusState.visible = false;
  statusState.text = '';

  statusWrapper.classList.add('hidden');
}
