import {scanPage} from './scan.js';
const $=id=>document.getElementById(id);
const SITE='https://clipdrop-video-downloader.netlify.app/';
let current;
function message(text){$('status').textContent=text;}
function openClipDrop(url){return chrome.tabs.create({url:SITE+'?url='+encodeURIComponent(url)});}
async function scan(){
  $('rescan').disabled=true;$('open-page').disabled=true;$('results').replaceChildren();
  try {
    [current]=await chrome.tabs.query({active:true,currentWindow:true});
    if (!current?.id || !/^https?:\/\//i.test(current.url || '')) throw Error('Open a normal website tab, then click ClipDrop. Chrome settings, store pages and PDFs may not allow scanning.');
    $('open-page').disabled=false;
    const results=await chrome.scripting.executeScript({target:{tabId:current.id},func:scanPage});
    const {videos=[],browserStreams=0}=results[0]?.result || {};
    message(videos.length ? `Found ${videos.length} exposed source${videos.length===1?'':'s'}. Choose a file below.` : browserStreams ? 'This page uses browser-only streaming. Try the page in ClipDrop; the stream may be unsupported or protected.' : 'No exposed video files found. Start playback and scan again, or try this page in ClipDrop.');
    for(const video of videos){
      const item=document.createElement('div');item.className='item';
      const title=document.createElement('strong');title.textContent=video.label;
      const detail=document.createElement('p');detail.textContent=video.format+' · '+new URL(video.url).hostname;
      const button=document.createElement('button');button.textContent=video.direct?'Download file ↓':'Choose formats ↗';
      button.addEventListener('click',async()=>{
        button.disabled=true;
        try {
          if(video.direct){await chrome.downloads.download({url:video.url,saveAs:true});message('Download sent to Chrome. Check the Downloads panel for its progress.');}
          else await openClipDrop(video.url);
        } catch {message('The file could not be downloaded. It may require access that Chrome cannot use for this download.');}
        finally{button.disabled=false;}
      });
      item.append(title,detail,button);$('results').append(item);
    }
  } catch(error){message(error.message);}
  finally{$('rescan').disabled=false;}
}
$('rescan').addEventListener('click',scan);
$('open-page').addEventListener('click',()=>{if(current?.url)openClipDrop(current.url);});
scan();
