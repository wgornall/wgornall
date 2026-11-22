(() => {
  "use strict";
  document.addEventListener('click',event=>{
    const dialog=event.target;
    if (!(dialog instanceof HTMLDialogElement) || !dialog.matches('.peer-publications[open]')) return;
    const bounds=dialog.getBoundingClientRect();
    if (event.clientX<bounds.left || event.clientX>bounds.right ||
        event.clientY<bounds.top || event.clientY>bounds.bottom) dialog.close();
  });

  function node(tag,attributes,text) {
    const element=document.createElementNS("http://www.w3.org/2000/svg",tag);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,value);
    if (text!==undefined) element.textContent=text;
    return element;
  }

  function tenureDotLayout(pointsByAge,gap=11,{minimumRowHeight=32,verticalGap=gap}={}) {
    let maxOffset=0;
    const rows=new Map();
    for (const [age,points] of pointsByAge) {
      const laneEnds=[];
      const positioned=points.toSorted((a,b)=>a.position-b.position).map(point=>{
        let lane=laneEnds.findIndex(previous=>point.position-previous.end >=
          (previous.radius!=null && point.dotRadius!=null ? previous.radius+point.dotRadius+1 : gap)-1e-7);
        if (lane<0) lane=laneEnds.length;
        laneEnds[lane]={end:point.layoutEnd??point.endPosition??point.position,radius:point.dotRadius};
        return {point,lane};
      });
      const laneCount=laneEnds.length;
      maxOffset=Math.max(maxOffset,(laneCount-1)*verticalGap/2);
      rows.set(age,positioned.map(({point,lane})=>{
        const distance=laneCount%2 ? Math.ceil(lane/2) : Math.floor(lane/2)+0.5;
        const offset=distance*verticalGap*(lane%2?1:-1);
        return {...point,offset:point.fixedOffset ?? offset};
      }));
    }
    return {rows,inset:maxOffset+7,rowHeight:Math.max(minimumRowHeight,2*maxOffset+verticalGap)};
  }

  function publicationQuantiles(values) {
    if (!values.length) return [];
    const sorted=values.toSorted((a,b)=>a-b);
    return [25,50,75].map(percentile=>{
      const rank=(sorted.length-1)*percentile/100;
      const lower=Math.floor(rank);
      const value=sorted[lower]+(rank-lower)*(sorted[Math.ceil(rank)]-sorted[lower]);
      return {percentile,value};
    });
  }

  function publicationAxis(values) {
    const peak=Math.max(1,...values);
    const factor=10**Math.floor(Math.log10(Math.max(1,peak/6)));
    const step=[1,2,5,10].map(n=>n*factor).find(n=>n>=peak/6);
    const max=Math.ceil(peak/step)*step;
    return {max,ticks:Array.from({length:Math.round(max/step)+1},(_,i)=>i*step)};
  }

  function percentileGuides(chart,guides,{left,right,top,bottom}) {
    const groups=new Map();
    for (const guide of guides) {
      const {x1,y1,x2,y2}=guide;
      const key=[x1,y1,x2,y2].join('/');
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(guide);
    }
    const labelData=[];
    for (const group of groups.values()) {
      const {x1,y1,x2,y2,description}=group[0];
      const slope=(x2-x1)/(y2-y1);
      const xAt=y=>Math.min(right,Math.max(left,x1+(y-y1)*slope));
      let start=bottom,end=top;
      if (slope) {
        const exits=[left,right].map(x=>y1+(x-x1)/slope);
        start=Math.min(bottom,Math.max(...exits));
        end=Math.max(top,Math.min(...exits));
      }
      if (start<=end) continue;
      const from=xAt(start),to=xAt(end);
      const median=group.some(({percentile})=>percentile===50);
      const name=group.map(({percentile})=>percentile+"th").join(" / ");
      const title=`${name} · ${description}`;
      const line=node("line",{x1:from,y1:start,x2:to,y2:end,class:"percentile-line",
        "stroke-width":median?2.1:1.6,"stroke-linecap":"round","stroke-dasharray":median?"":"1 3",
        tabindex:"0","aria-label":title,"data-tooltip":title});
      line.append(node("title",{},title));
      chart.append(line);

      labelData.push({x:to,name:group.some(({percentile})=>percentile===75) ? name+" pctl." : name});
    }
    // Place labels above the plot, spreading nearby endpoints to avoid overlap.
    labelData.sort((a,b)=>a.x-b.x);
    const gap=38;
    for (let i=0;i<labelData.length;i++) {
      const min=i ? labelData[i-1].x+gap : left+gap/2;
      labelData[i].x=Math.max(min,labelData[i].x);
    }
    for (let i=labelData.length-1;i>=0;i--) {
      const max=i===labelData.length-1 ? right-gap/2 : labelData[i+1].x-gap;
      labelData[i].x=Math.min(max,labelData[i].x);
    }
    return labelData.map(({x,name})=>node("text",{class:"percentile-label","aria-hidden":"true",
      "text-anchor":"middle",x,y:top-8},name));
  }

  function publicationChart(rows,{xLabel,focus,schoolName=school=>school,openCase,dotRadius=4,minimumRowHeight,verticalGap,minimumHeight=0,yearAdjustment="none",
    emptyText="No tenure cases match the selected schools."}) {
    const panel=document.createElement("section");
    panel.className="peer-panel";
    const yLabel="Years since PhD";
    const left=83,right=610,top=25;
    const ageStart=6,ageEnd=11;
    const factor=age=>yearAdjustment==="none"?1:yearAdjustment==="minus5"?age+5:age;
    const xGuides=yearAdjustment==="off" ? [] : publicationQuantiles(rows.map(row=>row.credits/factor(row.age)));
    const xAxis=publicationAxis([...rows.map(row=>row.credits+(row.nextYearCredits??0)),
      ...xGuides.map(({value})=>value*factor(ageEnd))]);
    const ages=Array.from({length:ageEnd-ageStart+1},(_,i)=>ageStart+i);
    const x=value=>left+10+(right-left-20)*value/xAxis.max;
    const pointsByAge=ages.map(age=>{
      const groups=new Map();
      for (const row of rows.filter(row=>row.age===age)) {
        const group=groups.get(row.credits) || []; group.push(row); groups.set(row.credits,group);
      }
      const points=[];
      for (const group of groups.values()) {
        const radius=group.length>9 ? dotRadius*.7 : dotRadius;
        const maxRows=group.length>9 ? 4 : 3;
        const columns=Math.ceil(group.length/maxRows);
        const spacing=radius*2+1;
        const sizes=Array(columns).fill(Math.floor(group.length/columns));
        const center=(columns-1)/2;
        const priority=sizes.map((_,i)=>i).sort((a,b)=>Math.abs(a-center)-Math.abs(b-center) || a-b);
        for (let i=0;i<group.length%columns;i++) sizes[priority[i]]++;
        const positions=[];
        sizes.forEach((count,column)=>{
          const shift=(column-(columns-1)/2)*spacing;
          for (let rowIndex=0;rowIndex<count;rowIndex++) {
            positions.push({shift,offset:(rowIndex-(count-1)/2)*spacing});
          }
        });
        positions.sort((a,b)=>Math.hypot(a.shift,a.offset)-Math.hypot(b.shift,b.offset) || a.shift-b.shift || a.offset-b.offset);
        const ordered=group.toSorted((a,b)=>Number(b.school===focus)-Number(a.school===focus));
        ordered.forEach((row,index)=>{
          const {shift,offset}=positions[index];
          points.push({...row,dotRadius:radius,position:x(row.credits)+shift,layoutEnd:x(row.credits)+shift,
            fixedOffset:offset,
            endPosition:x(row.credits+(row.nextYearCredits??0))+shift});
        });
      }
      return [age,points];
    });
    const layout=tenureDotLayout(pointsByAge,2*dotRadius+1,
      {minimumRowHeight,verticalGap:Math.min(verticalGap ?? 2*dotRadius+1,2*dotRadius+1)});
    const bottom=Math.max(top+2*layout.inset+(ageEnd-ageStart)*layout.rowHeight,minimumHeight-47);
    const rowHeight=(bottom-top-2*layout.inset)/(ageEnd-ageStart);
    const y=age=>bottom-layout.inset-(age-ageStart)*rowHeight;
    const chart=node("svg",{viewBox:`0 0 640 ${bottom+47}`,class:"tenure-outcome-chart",role:"group",
      "aria-label":`${xLabel} by years since PhD`});
    for (const value of xAxis.ticks) {
      chart.append(node("line",{x1:x(value),x2:x(value),y1:top,y2:bottom,class:"grid"}),
        node("text",{x:x(value),y:bottom+19,"text-anchor":"middle"},String(value)));
    }
    for (const age of ages) {
      chart.append(node("line",{x1:left,x2:right,y1:y(age),y2:y(age),class:"grid"}),
        node("text",{x:left-9,y:y(age)+4,"text-anchor":"end"},String(age)));
    }
    chart.append(node("line",{x1:left,x2:right,y1:bottom,y2:bottom,class:"axis"}),
      node("line",{x1:left,x2:left,y1:top,y2:bottom,class:"axis"}),
      node("text",{x:(left+right)/2,y:bottom+38,"text-anchor":"middle"},xLabel),
      node("text",{transform:`translate(17 ${(top+bottom)/2}) rotate(-90)`,"text-anchor":"middle"},yLabel));

    const labels=percentileGuides(chart,xGuides.map(({percentile,value})=>({
      percentile,x1:x(value*factor(ageStart)),x2:x(value*factor(ageEnd)),y1:y(ageStart),y2:y(ageEnd),
      description:`${(value*factor(ageEnd)).toFixed(2)} credits at career year ${ageEnd}`
    })),{left,right,top,bottom});

    const orderedPoints=[...layout.rows.values()].flat()
      .sort((a,b)=>Number(a.school===focus)-Number(b.school===focus));
    for (const row of orderedPoints) {
        const school=schoolName(row.school);
        const center=y(row.age)+row.offset;
        const color=row.school===focus?"var(--tenure-focal)":"var(--tenure-peer)";
        let label=`${row.name} · ${school} · ${row.credits} publication credits · Career year ${row.age}`;
        if (row.nextYearCredits>0) {
          const end=row.endPosition;
          const head=Math.min(4,(end-row.position)/3);
          const rise=(end-row.position)*Math.tan(Math.PI/8), tipY=center-rise;
          const length=Math.hypot(end-row.position,rise), ux=(end-row.position)/length, uy=-rise/length;
          const baseX=end-head*ux, baseY=tipY-head*uy;
          const path=`M ${row.position} ${center} L ${end} ${tipY} M ${baseX-head*uy} ${baseY+head*ux} L ${end} ${tipY} L ${baseX+head*uy} ${baseY-head*ux}`;
          const note=`+${row.nextYearCredits} credits in ${row.year+1} · ${row.credits+row.nextYearCredits} total`;
          const arrow=node("path",{d:path,class:"tenure-followup-arrow",fill:"none",stroke:color,
            "stroke-width":1.4,"stroke-linecap":"round","stroke-linejoin":"round",
            "data-start":row.credits,"data-end":row.credits+row.nextYearCredits,"aria-hidden":"true"});
          arrow.append(node("title",{},`${row.name} · ${note}`));
          chart.append(arrow);
          label+=` · ${note}`;
        }
        const dot=node("circle",{cx:row.position,cy:center,r:row.dotRadius,fill:color,
          class:"tenure-publication-point dot-hit","data-x":row.credits,"data-y":row.age,
          tabindex:"0",role:"button","aria-haspopup":"dialog","aria-label":label});
        dot.append(node("title",{},label));
        const open=()=>openCase(row,dot);
        dot.addEventListener("click",open);
        dot.addEventListener("keydown",event=>{
          if (event.key==="Enter" || event.key===" ") {
            event.preventDefault();
            open();
          }
        });
        chart.append(dot);
    }
    if (!rows.length) {
      chart.append(node("text",{x:(left+right)/2,y:(top+bottom)/2,"text-anchor":"middle"},emptyText));
    }
    chart.append(...labels);
    panel.append(chart);
    return panel;
  }

  const journalAbbreviations=new Map(Object.entries({
    "Journal of Finance":"JF","Journal of Financial Economics":"JFE","Review of Financial Studies":"RFS",
    "Journal of Financial and Quantitative Analysis":"JFQA","Review of Finance":"RoF","Management Science":"MS","Marketing Science":"MktSci",
    "American Economic Review":"AER","Econometrica":"ECTA","Journal of Political Economy":"JPE",
    "Quarterly Journal of Economics":"QJE","Review of Economic Studies":"REStud",
    "Review of Economics and Statistics":"REStat","American Economic Journal: Macroeconomics":"AEJ Macro",
    "The Accounting Review":"TAR","Review of Accounting Studies":"RAST","Journal of Management":"JOMgmt",
    "Journal of Marketing":"JMkt","Manufacturing & Service Operations Management":"M&SOM","Operations Research":"OR",
    "Strategic Management Journal":"SMJ","Organization Science":"OS"
  }));
  function journalAbbreviation(journal) {
    return journalAbbreviations.get(journal)
      ?? journal.split(/[^\p{L}]+/u).filter(word=>word && !/^(the|of|and|for|in|on|a)$/i.test(word))
        .map(word=>word[0].toUpperCase()).join("");
  }

  function renderPublicationTimeline(cell,row) {
    cell.className="tenure-case-timeline";
    if (row.year && row.phd) {
      const labels=["Before the event year","In the event year","One year later","Two years later"];
      const periods=[[],[],[],[]];
      for (const paper of row.timeline.toSorted((a,b)=>a.year-b.year || a.journal.localeCompare(b.journal))) {
        const offset=paper.year-row.year;
        if (offset<=2) periods[Math.max(0,offset+1)].push(paper.journal);
      }
      for (const [i,journals] of periods.entries()) {
        const beyondCoverage=i>0 && row.publicationEnd!=null && row.year+i-1>row.publicationEnd;
        if (!journals.length && !beyondCoverage) continue;
        const group=document.createElement("div");
        const label=document.createElement("strong");
        label.textContent=labels[i]+": ";
        group.append(label);
        if (beyondCoverage) {
          const unavailable=document.createElement("abbr");
          unavailable.title=`Publication data ends in ${row.publicationEnd}`;
          unavailable.textContent="n/a";
          group.append(unavailable);
        } else {
          for (const [j,journal] of journals.entries()) {
            if (j) group.append(", ");
            const abbr=document.createElement("abbr");
            abbr.title=journal;
            abbr.textContent=journalAbbreviation(journal);
            group.append(abbr);
          }
        }
        cell.append(group);
      }
    }
    if (!cell.firstChild) cell.textContent="—";
  }

  function paginatedCases(section) {
    const body=section.querySelector("tbody");
    const prev=section.querySelector("[data-case-prev]");
    const next=section.querySelector("[data-case-next]");
    const count=section.querySelector("[data-case-count]");
    const pageSize=20;
    let cases=[],page=0;

    function render() {
      section.querySelector('table').csvRows=()=>cases.map(row=>{
        const timeline=document.createElement('td');renderPublicationTimeline(timeline,row);
        return [row.name,row.school,row.phd,row.event ? [row.year,row.event,row.chartNote].filter(Boolean).join(" · ") : row.year,row.age,
          (timeline.children.length ? [...timeline.children].map(period=>period.textContent).join(" | ") : timeline.textContent),[row.cv||row.profile,row.outcomeReport].filter(Boolean).join(' · ')];
      });
      const start=page*pageSize;
      const visible=cases.slice(start,start+pageSize);
      body.replaceChildren();
      for (const row of visible) {
        const tr=body.insertRow();
        for (const value of [row.name,row.school,row.phd,row.event ? [row.year,row.event,row.chartNote].filter(Boolean).join(" · ") : row.year,row.age]) {
          tr.insertCell().textContent=value??"—";
        }
        renderPublicationTimeline(tr.insertCell(),row);
        const source=tr.insertCell();
        const profile=row.cv||row.profile;
        const links=[[profile,row.cv?"CV":"Profile"]];
        if (row.outcomeReport!==profile) links.push([row.outcomeReport,"Outcome source"]);
        for (const [url,label] of links) {
          if (!/^https?:\/\//i.test(url||"")) continue;
          const link=document.createElement("a");
          link.href=url;
          link.target="_blank";
          link.rel="noopener noreferrer";
          link.textContent=label;
          link.setAttribute("aria-label",`${label} for ${row.name}`);
          if (source.firstChild) source.append(document.createElement("br"));
          source.append(link);
        }
        if (!source.firstChild) source.textContent="—";
      }
      if (!visible.length) {
        const cell=body.insertRow().insertCell();
        cell.colSpan=section.querySelector("thead tr").cells.length;
        cell.textContent="No cases match this selection.";
      }
      count.textContent=cases.length?`${start+1}–${start+visible.length} of ${cases.length} cases`:"0 cases";
      prev.disabled=page===0;
      next.disabled=start+visible.length>=cases.length;
    }

    prev.addEventListener("click",()=>{page--;render();});
    next.addEventListener("click",()=>{page++;render();});
    return rows=>{
      cases=rows.toSorted((a,b)=>(b.year??0)-(a.year??0)
        || a.school.localeCompare(b.school) || a.name.localeCompare(b.name));
      page=0;
      section.hidden=false;
      render();
    };
  }

  function caseTable(container) {
    const focal=paginatedCases(container.querySelector('[data-case-table="focal"]'));
    const peers=paginatedCases(container.querySelector('[data-case-table="peers"]'));
    return (rows,focus,peerNames)=>{
      const peerSet=new Set(peerNames);
      container.querySelector('[data-case-table="focal"] h3').textContent=container.closest('#finance-tenure-peers') ? focus+" · All recorded outcomes" : focus;
      focal(rows.filter(row=>row.school===focus));
      peers(rows.filter(row=>row.plotted && peerSet.has(row.school)));
    };
  }

  window.TenureCharts={minimumPeerFaculty:10,publicationChart,tenureDotLayout,percentileGuides,caseTable,journalAbbreviation};
})();
