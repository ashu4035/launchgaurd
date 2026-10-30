import {jsPDF} from 'jspdf';
import type {Finding} from './AuditApp';
import {explanation,reportArea,safeImage} from './VisualReport';

export function createPdfReport(scan:{siteName?:string;environment?:string;status:string;createdAt:string;findings?:Finding[]}){
 const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
 const left=18,width=174;let y=32;
 const font=(size=10,bold=false)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(32,45,50);};
 const next=()=>{pdf.addPage();y=32;};
 const room=(height:number)=>{if(y+height>274)next();};
 const text=(value:string,size=10,bold=false)=>{
  font(size,bold);const rows=pdf.splitTextToSize(value,width) as string[];
  for(const line of rows){room(5);pdf.text(line,left,y);y+=5;}y+=3;
 };
 const section=(title:string)=>{room(18);y+=3;text(title,12,true);};
 const block=(title:string,value:string)=>{room(18);text(title,10,true);text(value);};
 const findings=scan.findings||[],defects=findings.filter(f=>['Issue','Warning'].includes(f.status));
 text('Website audit report',23,true);text(scan.siteName||'Website',13,true);
 const date=new Date(scan.createdAt);
 text([scan.environment,scan.status,Number.isNaN(date.getTime())?scan.createdAt:date.toISOString().replace('T',' ').slice(0,19)+' UTC'].filter(Boolean).join('  |  '),9);
 const totals=[['Issues',findings.filter(f=>f.status==='Issue').length],['Warnings',findings.filter(f=>f.status==='Warning').length],['Unverified',findings.filter(f=>f.status==='Could not verify').length]];
 room(25);
 totals.forEach(([label,value],i)=>{const x=left+i*59;pdf.setFillColor(237,244,242);pdf.rect(x,y,56,21,'F');font(17,true);pdf.text(String(value),x+4,y+9);font(9);pdf.text(String(label),x+4,y+16);});y+=29;
 section('Defects by area');
 const columns=[18,83,105,127,149,171];
 const row=(values:string[],header=false)=>{
  room(10);if(header)pdf.setFillColor(225,235,232);else pdf.setFillColor(247,249,250);
  pdf.rect(left,y,width,10,'F');font(9,header);values.forEach((value,i)=>pdf.text(value,columns[i]+3,y+6.5));
  pdf.setDrawColor(213,222,224);pdf.line(left,y+10,left+width,y+10);y+=10;
 };
 row(['Area','Critical','High','Medium','Low','Total'],true);
 for(const area of ['Accessibility','SEO','Functional','Content','Technical']){
  const items=defects.filter(f=>reportArea(f)===area);
  row([area,...['Critical','High','Medium','Low'].map(level=>String(items.filter(f=>f.severity===level).length)),String(items.length)]);
 }
 y+=7;text('Zero findings do not establish that an area was fully tested.',9);
 section('Scope and evidence');
 text('This report includes all findings from this audit, regardless of interface filters. Annotated screenshots locate affected elements; they do not independently prove a failed destination or missing attribute. Unavailable screenshots retain their capture reason.',9);
 text('Confidential: share this report only with trusted recipients.',9,true);
 findings.forEach((f,index)=>{
  next();pdf.setFillColor(226,241,235);pdf.rect(left,y-5,width,10,'F');
  text(`BUG-${String(index+1).padStart(3,'0')}  |  ${reportArea(f)}  |  ${f.severity}  |  ${f.status}`,10,true);y+=3;
  text(f.title,16,true);text('Page: '+(f.url||f.page||'Saved settings'),9);
  const info=explanation(f);
  block('What is wrong',f.observed||f.detail);block('Expected',f.expected||info.expected);
  block('Why it matters',info.why);block('How to fix',f.fix);
  let images=0;
  for(const capture of f.visualEvidence?.captures||[]){
   const valid=(['closeup','context'] as const).filter(kind=>safeImage(capture[kind]));if(!valid.length)continue;
   // Keep both images and captions together, with their aspect ratios preserved.
   const slot=84,maxHeight=76;
   const sizes=valid.map(kind=>{const image=pdf.getImageProperties(capture[kind]);const w=Math.min(slot,maxHeight*image.width/image.height,image.width*25.4/144);return{kind,w,h:w*image.height/image.width};});
   const height=Math.max(...sizes.map(s=>s.h));room(height+27);
   text(`Visual evidence: ${capture.viewport.width<600?'Mobile':'Desktop'} (${capture.viewport.width} x ${capture.viewport.height})`,10,true);
   const top=y;
   sizes.forEach(({kind,w,h},i)=>{const x=left+i*90;pdf.setFillColor(245,247,248);pdf.rect(x,top,slot,height,'F');pdf.addImage(capture[kind],'JPEG',x+(slot-w)/2,top,w,h);font(8);pdf.text(kind==='closeup'?'Affected element close-up':'Page location, outlined in red',x,top+height+5);images++;});y=top+height+12;
  }
  if(!images)block('Visual evidence','Screenshot unavailable: '+(f.visualEvidence?.reason||'No visual evidence was captured in this audit.'));
  section('Technical details');text('Rule: '+f.ruleId,9);text('Evidence: '+f.detail,9);
  if(f.resourceUrl)text('Resource: '+f.resourceUrl,9);text('Finding ID: '+f.id,9);
 });
 const count=pdf.getNumberOfPages();
 for(let page=1;page<=count;page++){
  pdf.setPage(page);font(10,true);pdf.text('LaunchGuard',left,15);font(8);pdf.text('WEBSITE QUALITY AUDIT',192,15,{align:'right'});
  pdf.setDrawColor(41,122,101);pdf.line(left,21,192,21);pdf.setDrawColor(213,222,224);pdf.line(left,281,192,281);
  font(8);pdf.text('Confidential audit report',left,287);pdf.text(`${page} / ${count}`,192,287,{align:'right'});
 }
 pdf.setProperties({title:'LaunchGuard website audit report',subject:scan.siteName||'Website audit',creator:'LaunchGuard'});
 return pdf;
}
