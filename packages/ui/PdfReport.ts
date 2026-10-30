import {jsPDF} from 'jspdf';
import type {Finding} from './AuditApp';
import {explanation,reportArea,safeImage} from './VisualReport';

export function createPdfReport(scan:{siteName?:string;environment?:string;status:string;createdAt:string;findings?:Finding[]}){
 const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});let y=18;
 const room=(height:number)=>{if(y+height>278){pdf.addPage();y=18;}};
 const text=(value:string,size=10,bold=false)=>{
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
  for(const line of pdf.splitTextToSize(value,174) as string[]){room(6);pdf.text(line,18,y);y+=6;}y+=2;
 };
 text('LaunchGuard audit report',20,true);
 text([scan.siteName,scan.environment,scan.status,scan.createdAt].filter(Boolean).join(' | '));
 text('Annotated screenshots locate affected elements; they do not independently prove a failed destination or missing attribute. Share only with trusted recipients.');
 text('Defects by area',14,true);text('Area | Critical | High | Medium | Low | Total',10,true);
 const findings=scan.findings||[];
 for(const area of ['Accessibility','SEO','Functional','Content','Technical']){
  const rows=findings.filter(f=>reportArea(f)===area&&['Issue','Warning'].includes(f.status));
  text([area,...['Critical','High','Medium','Low'].map(level=>rows.filter(f=>f.severity===level).length),rows.length].join(' | '));
 }
 text(`${findings.filter(f=>f.status==='Could not verify').length} unverified. Zero findings do not establish that an area was fully tested.`);
 findings.forEach((f,index)=>{
  pdf.addPage();y=18;
  text(`BUG-${String(index+1).padStart(3,'0')} | ${reportArea(f)} | ${f.severity} | ${f.status}`,10,true);
  text(f.title,16,true);text('Page: '+(f.url||f.page||'Saved settings'));
  const info=explanation(f);
  for(const [label,value] of [['What is wrong',f.observed||f.detail],['Expected',f.expected||info.expected],['Why it matters',info.why],['How to fix',f.fix]]){text(label,11,true);text(value);}
  let images=0;
  for(const capture of f.visualEvidence?.captures||[]){
   for(const kind of ['closeup','context'] as const){
    const data=capture[kind];if(!safeImage(data))continue;
    const image=pdf.getImageProperties(data);
    const width=Math.min(174,120*image.width/image.height),height=width*image.height/image.width;
    room(height+20);text(`${capture.viewport.width} x ${capture.viewport.height}: ${kind==='closeup'?'Affected element close-up':'Page location, marked in red'}`,10,true);
    pdf.addImage(data,'JPEG',18,y,width,height);y+=height+6;images++;
   }
  }
  if(!images)text('Screenshot unavailable: '+(f.visualEvidence?.reason||'No visual evidence was captured in this audit.'));
  text('Technical details',11,true);text('Rule: '+f.ruleId);text('Evidence: '+f.detail);
  if(f.resourceUrl)text('Resource: '+f.resourceUrl);text('Finding ID: '+f.id);
 });
 const count=pdf.getNumberOfPages();
 for(let page=1;page<=count;page++){pdf.setPage(page);pdf.setFontSize(9);pdf.text(`${page} / ${count}`,192,289,{align:'right'});}
 return pdf;
}
