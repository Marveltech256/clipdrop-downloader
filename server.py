import json, os, re, secrets, subprocess, sys, threading
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '.deps'))
DOWNLOADS = ROOT / 'downloads'
DOWNLOADS.mkdir(exist_ok=True)
JOBS = {}
LOCK = threading.Lock()
CHOICES = {}

def available_formats(info):
    result = []
    for f in info.get('formats', []):
        if f.get('has_drm') or not f.get('url') or f.get('ext') not in ('mp4', 'webm', 'm4a', 'mp3', 'ogg', 'opus'):
            continue
        has_video = f.get('vcodec') not in (None, 'none')
        has_audio = f.get('acodec') not in (None, 'none')
        if not has_video and not has_audio:
            continue
        fid = f['format_id']
        ext = f['ext']
        selector = fid
        kind = 'Video + audio' if has_video else 'Audio only'
        if has_video and not has_audio:
            audio = [a for a in info.get('formats', []) if a.get('vcodec') == 'none' and a.get('acodec') not in (None, 'none') and a.get('url') and not a.get('has_drm')]
            compatible = [a for a in audio if a.get('ext') == ('m4a' if ext == 'mp4' else 'webm')]
            audio = compatible or audio
            if audio:
                best = max(audio, key=lambda a: a.get('abr') or a.get('tbr') or 0)
                selector += '+' + best['format_id']
                if not compatible: ext = 'mkv'
            else:
                kind = 'Video only (no audio available)'
        key = secrets.token_hex(12)
        CHOICES[key] = {'url': info['webpage_url'], 'selector': selector, 'ext': ext}
        result.append({'id': key, 'height': f.get('height') or 0, 'ext': ext, 'size': f.get('filesize') or f.get('filesize_approx') if '+' not in selector else None, 'fps': f.get('fps'), 'kind': kind, 'codec': (f.get('vcodec') if has_video else f.get('acodec') or '').split('.')[0], 'bitrate': round(f.get('abr') or f.get('tbr') or 0), 'source_id': fid})
    result.sort(key=lambda f: (f['height'], f['fps'] or 0, f['bitrate']), reverse=True)
    return result

def video_url(value):
    u = urlparse(value.strip())
    if u.scheme not in ('https', 'http') or u.hostname not in ('youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be'):
        raise ValueError('Paste a valid YouTube video link.')
    vid = u.path.strip('/') if u.hostname.endswith('youtu.be') else (parse_qs(u.query).get('v', [''])[0] if u.path == '/watch' else u.path.split('/')[-1] if u.path.startswith(('/shorts/', '/live/', '/embed/')) else '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', vid):
        raise ValueError('This link does not contain a valid YouTube video ID.')
    return 'https://www.youtube.com/watch?v=' + vid

def options():
    return {'noplaylist': True, 'quiet': True, 'no_warnings': True, 'socket_timeout': 20, 'retries': 2, 'cachedir': False, 'js_runtimes': {'node': {}}}

def download(job_id, url, choice):
    try:
        import yt_dlp
        import imageio_ffmpeg
        opts = options() | {'format': choice['selector'], 'merge_output_format': choice['ext'], 'ffmpeg_location': imageio_ffmpeg.get_ffmpeg_exe(), 'outtmpl': str(DOWNLOADS / (job_id + '.%(ext)s')), 'max_filesize': 1024**3}
        def progress(d):
            with LOCK:
                JOBS[job_id]['progress'] = round(100 * d.get('downloaded_bytes', 0) / (d.get('total_bytes') or d.get('total_bytes_estimate') or 1)) if d['status'] == 'downloading' else 100
        opts['progress_hooks'] = [progress]
        final_paths = []
        def postprocess(d):
            with LOCK:
                JOBS[job_id]['phase'] = 'Merging video and audio…'
            if d['status'] == 'finished' and d.get('info_dict', {}).get('filepath'):
                final_paths.append(d['info_dict']['filepath'])
        opts['postprocessor_hooks'] = [postprocess]
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            path = Path(final_paths[-1] if final_paths else ydl.prepare_filename(info))
            if not path.is_file():
                path = DOWNLOADS / (job_id + '.' + choice['ext'])
            if not path.is_file(): raise ValueError('The downloaded file could not be found.')
        with LOCK:
            JOBS[job_id].update(status='ready', path=str(path), filename=re.sub(r'[^\w .-]', '', info.get('title','video'))[:120] + path.suffix)
    except Exception as e:
        with LOCK:
            JOBS[job_id].update(status='error', error=str(e))

class Handler(SimpleHTTPRequestHandler):
    def authorized(self):
        token = os.environ.get('API_TOKEN')
        return not token or secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token)
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / 'static'), **kw)
    def reply(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        if not self.authorized(): return self.reply({'error':'Unauthorized'},401)
        if self.headers.get('Origin') not in (None, 'http://127.0.0.1:8787', 'http://localhost:8787'):
            return self.reply({'error':'Origin not allowed'},403)
        try:
            size = int(self.headers.get('Content-Length',0))
            if not 0 < size < 4096: raise ValueError('Invalid request.')
            body = json.loads(self.rfile.read(size)); url = video_url(body.get('url',''))
            import yt_dlp
            if self.path == '/api/info':
                with yt_dlp.YoutubeDL(options()) as ydl: info = ydl.extract_info(url, download=False)
                with LOCK:
                    if len(CHOICES) > 10000: CHOICES.clear()
                    formats = available_formats(info)
                return self.reply({'title':info.get('title'),'channel':info.get('uploader'),'duration':info.get('duration'),'thumbnail':info.get('thumbnail'),'formats':formats,'url':url})
            if self.path == '/api/download':
                fmt = str(body.get('format',''))
                with LOCK:
                    choice = CHOICES.get(fmt)
                    if not choice or video_url(choice['url']) != url: raise ValueError('Fetch the video again and choose an available format.')
                    if any(j['status']=='downloading' for j in JOBS.values()): raise ValueError('A download is already running. Please wait.')
                    jid = secrets.token_hex(16); JOBS[jid] = {'status':'downloading','progress':0}
                threading.Thread(target=download,args=(jid,url,choice),daemon=True).start()
                return self.reply({'id':jid})
            self.reply({'error':'Not found'},404)
        except Exception as e: self.reply({'error':str(e)},400)
    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/health': return self.reply({'ready':True})
        if path.startswith('/api/jobs/') and not self.authorized(): return self.reply({'error':'Unauthorized'},401)
        if path.startswith('/api/jobs/'):
            with LOCK: job = dict(JOBS.get(path.split('/')[-1],{}))
            job.pop('path',None)
            return self.reply(job,200 if job else 404)
        if path.startswith('/api/files/'):
            with LOCK: job = dict(JOBS.get(path.split('/')[-1],{}))
            if job.get('status') != 'ready': return self.reply({'error':'File not ready'},404)
            file = Path(job['path'])
            self.send_response(200); self.send_header('Content-Type','application/octet-stream'); self.send_header('Content-Disposition','attachment; filename="' + job['filename'].encode('ascii','ignore').decode().replace('"','') + '"'); self.send_header('Content-Length',str(file.stat().st_size)); self.end_headers()
            try:
                with file.open('rb') as f:
                    while chunk := f.read(65536): self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError): pass
            return
        super().do_GET()

if __name__ == '__main__':
    print('ClipDrop is running at http://127.0.0.1:8787', flush=True)
    ThreadingHTTPServer((os.environ.get('BIND_HOST','127.0.0.1'),int(os.environ.get('PORT','8787'))),Handler).serve_forever()
