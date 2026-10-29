export function scanPage() {
  const found = new Map();
  let browserStreams = 0;
  const add = (raw, type, label) => {
    if (!raw) return;
    if (/^(blob:|data:)/i.test(raw)) { browserStreams++; return; }
    try {
      const url = new URL(raw, document.baseURI);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return;
      const file = /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(url.href);
      const stream = /\.(m3u8|mpd)(?:$|[?#])/i.test(url.href);
      const direct = !stream && (file || /video\/(mp4|webm|ogg|quicktime)/i.test(type || ''));
      found.set(url.href, {url:url.href, direct, label:label || (direct ? 'Video file' : 'Video source'), format:stream ? 'Streaming manifest' : type || (file ? url.pathname.split('.').pop().toUpperCase() : 'Page / source')});
    } catch {}
  };
  document.querySelectorAll('video').forEach((video, i) => {
    if (video.mediaKeys) return;
    add(video.currentSrc || video.src, video.getAttribute('type'), 'Video ' + (i+1));
    video.querySelectorAll('source').forEach(source => add(source.src,source.type,'Video '+(i+1)));
  });
  document.querySelectorAll('a[href]').forEach(a => {
    if (/\.(mp4|webm|mov|m4v|ogv|m3u8|mpd)(?:$|[?#])/i.test(a.href)) add(a.href,'',a.textContent.trim().slice(0,70) || 'Linked video');
  });
  document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]').forEach(meta => add(meta.content,'','Embedded video'));
  document.querySelectorAll('iframe[src]').forEach(frame => {
    try { const u=new URL(frame.src,document.baseURI); if (/(^|\.)(youtube\.com|youtube-nocookie\.com|vimeo\.com|dailymotion\.com)$/.test(u.hostname)) add(u.href,'','Embedded player'); } catch {}
  });
  return {videos:Array.from(found.values()).slice(0,40), browserStreams};
}
