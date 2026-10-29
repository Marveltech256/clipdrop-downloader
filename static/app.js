const $ = id => document.getElementById(id);
let video, busy = false;
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  $('fetch').disabled = true;
  fetch('/api/health').then(r => r.json()).then(data => {
    if (data.ready) { $('fetch').disabled = false; }
    else { status(data.error || 'Online downloads are being set up. Please check back soon.'); }
  }).catch(() => status('The download server is temporarily unavailable. Please try again later.', true));
}
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
$('form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('fetch').disabled = true; $('fetch').textContent = 'Fetching…'; $('result').hidden = true;
  status('Getting video details. This can take a moment…');
  try {
    video = await api('/api/info', { url: $('url').value.trim() });
    $('title').textContent = video.title;
    const duration = video.duration ? Math.floor(video.duration / 60) + ':' + String(Math.floor(video.duration % 60)).padStart(2, '0') : '';
    $('meta').textContent = [video.channel, duration].filter(Boolean).join(' · ');
    $('thumb').src = video.thumbnail || ''; $('thumb').hidden = !video.thumbnail;
    $('formats').replaceChildren(...video.formats.map(f => {
      const option = document.createElement('option'); option.value = f.id;
      option.textContent = `${f.height ? f.height + 'p' : f.bitrate + ' kbps'}${f.fps > 30 ? ' ' + f.fps + 'fps' : ''} · ${f.ext.toUpperCase()} · ${f.kind} · ${f.codec} [${f.source_id}]${f.size ? ' · ' + (f.size / 1048576).toFixed(1) + ' MB' : ''}`;
      return option;
    }));
    $('download').disabled = !video.formats.length; $('download').hidden = false; $('save').hidden = true; $('progress').hidden = true;
    $('result').hidden = false;
    status(video.formats.length ? 'Choose a format. Separate video and audio tracks are merged automatically.' : 'YouTube did not return any downloadable streams. The video may be restricted or temporarily blocked.', !video.formats.length);
  } catch (e) { status(e.message, true); }
  finally { busy = false; $('fetch').disabled = false; $('fetch').textContent = 'Fetch video →'; }
});
$('download').addEventListener('click', async () => {
  if (busy || !video) return;
  busy = true; $('download').disabled = true; $('fetch').disabled = true; $('progress').hidden = false; $('bar').style.width = '0%';
  try {
    const job = await api('/api/download', {url:video.url, format:$('formats').value});
    status('Preparing your download…');
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const state = await api('/api/jobs/' + job.id);
      if (state.status === 'error') throw Error(state.error);
      $('bar').style.width = Math.min(100, state.progress || 0) + '%';
      if (state.status === 'ready') {
        $('save').href = '/api/files/' + job.id; $('save').download = state.filename; $('save').hidden = false; $('download').hidden = true;
        status('Your video is ready. Save it within 10 minutes. This link can be used once.'); break;
      }
      status(state.phase || `Downloading… ${Math.min(100, state.progress || 0)}%`);
    }
  } catch (e) { status(e.message, true); }
  finally { busy = false; $('download').disabled = false; $('fetch').disabled = false; }
});
