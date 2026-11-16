/* Aggregate history figures. No person-level data or external chart runtime. */

(()=>{
const data=JSON.parse(document.getElementById('decade-data').textContent);
const chart=document.getElementById('decade-chart'),plot=document.getElementById('decade-plot'),button=document.getElementById('decade-toggle');
if(!chart||!plot||!button)return;
const byId=new Map(data.schools.map(s=>[s.id,s]));
let limit=5,drawnCompact;
const isCompact=()=>{const width=chart.parentElement?.clientWidth;return width?width<=640:Boolean(window.matchMedia?.('(max-width:640px)')?.matches);};
const x=i=>130+172.25*i,y=rank=>82+(rank-1)*70;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function highlight(id){chart.querySelectorAll('.decade-school').forEach(mark=>mark.classList.toggle('decade-dim',Boolean(id)&&mark.dataset.school!==id));}
function bindMarks(){chart.querySelectorAll('.decade-node').forEach(node=>{node.addEventListener('pointerenter',()=>highlight(node.dataset.school));node.addEventListener('pointerleave',()=>highlight(''));node.addEventListener('focus',()=>highlight(node.dataset.school));node.addEventListener('blur',()=>highlight(''));});}
function render(compact=isCompact()){
 drawnCompact=compact;chart.classList.toggle('is-compact',compact);
 const last=y(limit),parts=['<rect x="0" y="0" width="100%" height="100%" fill="#fff"/><text class="decade-axis" x="18" y="39" text-anchor="start">Rank</text>'];
 for(let rank=1;rank<=limit;rank++)parts.push(`<line class="decade-grid" x1="85" x2="854" y1="${y(rank)}" y2="${y(rank)}"/><text class="decade-rank" x="24" y="${y(rank)+9}" text-anchor="start">${rank}</text>`);
 data.periods.forEach((period,i)=>parts.push(`<text class="decade-period" x="${x(i)}" y="32" text-anchor="middle">${escape(compact?Math.floor(period.start/10)*10+'s':period.label)}</text><line class="decade-column" x1="${x(i)}" x2="${x(i)}" y1="52" y2="${last+32}"/>`));
 parts.push('<g id="decade-lines">');
 data.schools.forEach(s=>{
  const runs=[];let run=[];
  data.periods.forEach((period,i)=>{const entry=period.top.find(e=>e.id===s.id&&e.rank<=limit);if(entry)run.push([i,entry.rank]);else if(run.length){runs.push(run);run=[];}});if(run.length)runs.push(run);
  runs.filter(points=>points.length>1).forEach(points=>{
   const segments=points.slice(1).map(([i,rank],j)=>{const [previous,previousRank]=points[j];return `M${x(previous)+18},${y(previousRank)} L${x(i)-18},${y(rank)}`;}).join(' ');
   parts.push(`<path class="decade-school decade-line" data-school="${escape(s.id)}" d="${segments}" fill="none" stroke="${s.color}" stroke-width="3.1" stroke-linejoin="round" stroke-linecap="round"><title>${escape(s.fullName)}</title></path>`);
  });
 });
 parts.push('</g><g id="decade-markers">');
 data.periods.forEach((period,i)=>period.top.filter(e=>e.rank<=limit).forEach(e=>{
  let tip=e.fullName+' · '+period.label+' · rank #'+e.rank+' · '+e.share.toFixed(2)+'% of total scores · score '+e.score.toFixed(2);
  if(e.tieBreak)tip+=' · tie-break only: '+e.tieBreak.start+'–'+e.tieBreak.end+' score '+e.tieBreak.score.toFixed(2);
  const logo=document.getElementById('decade-logo-'+e.id);
  const glyph=logo?`<use class="decade-logo" href="#decade-logo-${escape(e.id)}" x="${x(i)-32}" y="${y(e.rank)-32}" width="64" height="64"/>`:`<text class="decade-fallback" x="${x(i)}" y="${y(e.rank)+6}" text-anchor="middle">${escape(byId.get(e.id).abbreviation)}</text>`;
  parts.push(`<g class="decade-school decade-node" data-school="${escape(e.id)}" tabindex="0" role="img" aria-label="${escape(tip)}"><title>${escape(tip)}</title><circle class="decade-marker-back" cx="${x(i)}" cy="${y(e.rank)}" r="40"/>${glyph}</g>`);
 }));
 parts.push('</g><g id="decade-labels">');
 data.periods.at(-1).top.filter(e=>e.rank<=limit).forEach(e=>{const s=byId.get(e.id);parts.push(`<text class="decade-school decade-end-label" data-school="${escape(e.id)}" x="869" y="${y(e.rank)+5}" style="fill:${s.color}">${escape(s.name)}</text>`);});
 parts.push(`</g>`);
 plot.innerHTML=parts.join('');chart.setAttribute('viewBox','0 0 '+(compact?880:980)+' '+(last+48));
 document.getElementById('decade-desc').textContent='Top '+limit+' schools in each decade, from the 1980s through the partial 2020s. Only the latest top '+limit+' have name labels, all on the right. Lines break when a school leaves the displayed ranks.';
 const expanded=limit===10;button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',expanded?'Show top 5 schools':'Show top 10 schools');
 document.getElementById('decade-toggle-icon').textContent=expanded?'−':'+';document.getElementById('decade-toggle-label').textContent=expanded?'Show top 5':'Show top 10';
 bindMarks();
}
button.addEventListener('click',()=>{limit=limit===5?10:5;render();});
window.PHD_CHART_EXPORTS=window.PHD_CHART_EXPORTS||{};
window.PHD_CHART_EXPORTS['decade-chart']=()=>{const compact=isCompact();render(false);const copy=chart.cloneNode(true);render(compact);return copy;};
if(window.ResizeObserver)new window.ResizeObserver(()=>{if(isCompact()!==drawnCompact)render();}).observe(chart.parentElement);
window.addEventListener('resize',()=>{if(isCompact()!==drawnCompact)render();});
render();
})();


(()=>{
const data=JSON.parse(document.getElementById('previous-data').textContent);
const chart=document.getElementById('previous-chart'),plot=document.getElementById('previous-plot');
if(!chart||!plot)return;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const isCompact=()=>{const width=chart.parentElement?.clientWidth;return width?width<=640:Boolean(window.matchMedia?.('(max-width:640px)')?.matches);};
let layout,focus,drawnCompact;
function render(compact=isCompact()){
 drawnCompact=compact;
 layout=compact?{w:720,h:455,l:76,r:692,t:24,b:380,font:15}:{w:1200,h:410,l:76,r:1134,t:18,b:346,font:15};
 const c=layout,x=i=>c.l+i*(c.r-c.l)/(data.windows.length-1),y=v=>c.b-v*(c.b-c.t)/100;
 const parts=[];
 for(let value=0;value<=100;value+=20)parts.push(`<line class="history-grid" x1="${c.l}" x2="${c.r}" y1="${y(value)}" y2="${y(value)}"/><text class="history-tick" x="${c.l-10}" y="${y(value)+c.font/3}" font-size="${c.font}" text-anchor="end">${value}%</text>`);
 [1995,2000,2010,2020,2026].filter(year=>data.years.includes(year)).forEach(year=>parts.push(`<text class="history-tick" x="${x(data.years.indexOf(year))}" y="${c.b+27}" font-size="${c.font}" text-anchor="middle">${year}</text>`));
 const lower=data.windows.map(()=>0),uppers=[];
 data.bands.forEach((band,i)=>{
  const upper=data.windows.map((w,j)=>i===data.bands.length-1?100:lower[j]+w.shares[i]);uppers.push(upper);
  const shape=upper.map((v,j)=>(j?'L':'M')+x(j)+','+y(v)).join(' ')+' '+lower.map((v,j)=>[j,v]).reverse().map(([j,v])=>'L'+x(j)+','+y(v)).join(' ')+' Z';
  parts.push(`<path class="history-band" d="${shape}" fill="${band.color}" fill-opacity="0.13" stroke="none"/>`);upper.forEach((v,j)=>lower[j]=v);
 });
 data.bands.forEach((band,i)=>parts.push(`<polyline class="history-boundary" points="${uppers[i].map((v,j)=>x(j)+','+y(v)).join(' ')}" fill="none" stroke="${band.color}" stroke-width="${compact?3:2.4}" stroke-linecap="round" stroke-linejoin="round"/>`));
 const midpoint=Math.floor((data.windows.length-1)/2),labelX=x(midpoint),centerYear=data.windows[midpoint].year;
 const centerRange=data.windows.map((w,i)=>({year:w.year,i})).filter(w=>Math.abs(w.year-centerYear)<=5).map(w=>w.i);
 data.bands.forEach((band,i)=>{
  const top=Math.max(...centerRange.map(j=>y(uppers[i][j]))),bottom=Math.min(...centerRange.map(j=>y(i?uppers[i-1][j]:0)));
  const bandMidpoint=(y(uppers[i][midpoint])+y(i?uppers[i-1][midpoint]:0))/2;
  const center=band.name==='Any scored placements'||top>bottom?bandMidpoint:(top+bottom)/2;
  parts.push(`<text class="history-direct-label" x="${labelX}" y="${center}" text-anchor="middle" dominant-baseline="central" fill="${band.color}" font-size="${c.font}">${escape(band.name)}</text>`);
 });
 parts.push(`<text class="history-tick" x="${(c.l+c.r)/2}" y="${c.h-10}" font-size="${c.font}" text-anchor="middle">PhD year (window end)</text><g id="previous-focus" aria-hidden="true"></g>`);
 plot.innerHTML=parts.join('');chart.setAttribute('viewBox','0 0 '+c.w+' '+c.h);focus=document.getElementById('previous-focus');
}
function inspect(index){
 const c=layout,w=data.windows[index],x=c.l+index*(c.r-c.l)/(data.windows.length-1);let upper=0;
 const parts=[`<line class="history-focus" x1="${x}" x2="${x}" y1="${c.t}" y2="${c.b}"/>`];
 data.bands.forEach((band,i)=>{upper+=w.shares[i];parts.push(`<circle cx="${x}" cy="${c.b-upper*(c.b-c.t)/100}" r="4" fill="${band.color}"><title>${escape(band.name)}: ${w.shares[i].toFixed(2)}% · ${w.start}–${w.end} · ranks from ${w.priorDecade}</title></circle>`);});focus.innerHTML=parts.join('');
}
chart.addEventListener('pointermove',event=>{const point=chart.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const pos=point.matrixTransform(chart.getScreenCTM().inverse()),c=layout;if(pos.x>=c.l&&pos.x<=c.r&&pos.y>=c.t&&pos.y<=c.b)inspect(Math.round((pos.x-c.l)/(c.r-c.l)*(data.windows.length-1)))});
chart.addEventListener('pointerleave',()=>{focus.innerHTML='';});
window.PHD_CHART_EXPORTS=window.PHD_CHART_EXPORTS||{};
window.PHD_CHART_EXPORTS['previous-chart']=()=>{const compact=isCompact();render(false);const copy=chart.cloneNode(true);render(compact);return copy;};
if(window.ResizeObserver)new window.ResizeObserver(()=>{if(isCompact()!==drawnCompact)render();}).observe(chart.parentElement);
window.addEventListener('resize',()=>{if(isCompact()!==drawnCompact)render();});render();
})();

(()=>{
const styles=`svg{font-family:Inter,Arial,sans-serif;background:#fff}.decade-grid,.history-grid{stroke:#dde4e3;stroke-width:1;stroke-dasharray:3 5}.decade-column{stroke:#dde4e3;stroke-width:1}.decade-rank{fill:#000;font:600 26px monospace}.decade-period{font-size:18px;fill:#000;font-weight:650}.decade-axis{font-size:14px;fill:#000}.decade-end-label{font-size:17px;font-weight:650;paint-order:stroke;stroke:#fff;stroke-width:5px}.decade-marker-back{fill:url(#decade-logo-halo)}.decade-fallback{font-size:20px;fill:#172d35}.history-tick{fill:#000}.history-direct-label{font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:3px}`;
function wrap(ctx,text,width){const lines=[];let line='';for(const word of text.trim().split(/\s+/)){const candidate=line?line+' '+word:word;if(line&&ctx.measureText(candidate).width>width){lines.push(line);line=word;}else line=candidate;}if(line)lines.push(line);return lines;}
function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.querySelectorAll('[data-download-chart]').forEach(button=>button.addEventListener('click',async()=>{
 const figure=button.closest('figure'),chart=document.getElementById(button.dataset.downloadChart);button.disabled=true;
 try{
  const copy=window.PHD_CHART_EXPORTS?.[chart.id]?.()||chart.cloneNode(true);
  copy.classList.remove('is-compact');copy.querySelectorAll('.decade-dim').forEach(mark=>mark.classList.remove('decade-dim'));copy.querySelector('#previous-focus')?.replaceChildren();
  const box=copy.getAttribute('viewBox').split(/\s+/).map(Number);copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width',String(box[2]));copy.setAttribute('height',String(box[3]));
  const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent=styles;copy.insertBefore(style,copy.firstChild);
  const svg=new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml;charset=utf-8'}),source=URL.createObjectURL(svg);
  const image=new Image();
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=source;});}finally{URL.revokeObjectURL(source);}
  const width=1000,pad=24,inner=width-2*pad,canvas=document.createElement('canvas');canvas.width=width;
  let ctx=canvas.getContext('2d');ctx.font='600 22px Arial';const title=wrap(ctx,figure.querySelector('h2').textContent,inner);ctx.font='14px Arial';const caption=wrap(ctx,figure.querySelector('.caption-copy').textContent,inner);
  const titleHeight=title.length*28,chartHeight=Math.round(inner*box[3]/box[2]),chartTop=pad+titleHeight+12,captionTop=chartTop+chartHeight+16;
  canvas.height=captionTop+caption.length*20+pad;ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.strokeStyle='#dde4e3';ctx.lineWidth=1;ctx.strokeRect(.5,.5,width-1,canvas.height-1);
  ctx.fillStyle='#172d35';ctx.font='600 22px Arial';title.forEach((line,i)=>ctx.fillText(line,pad,pad+22+i*28));ctx.drawImage(image,pad,chartTop,inner,chartHeight);ctx.fillStyle='#000';ctx.font='14px Arial';caption.forEach((line,i)=>ctx.fillText(line,pad,captionTop+14+i*20));
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)throw new Error('PNG export unavailable');download(png,button.dataset.downloadName.replace(/\.svg$/i,'.png'));
 }catch(error){console.error('Figure download failed',error);button.setAttribute('title','Download unavailable. Please try again.');}finally{button.disabled=false;}
}));
})();
