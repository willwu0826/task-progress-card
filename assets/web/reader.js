(() => {
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderer = new globalThis.marked.Renderer();
  renderer.html = ({text}) => /^<br\s*\/?\s*>$/i.test(text.trim()) ? '<br>' : escape(text);
  renderer.link = function({href,title,tokens}) {
    const label=this.parser.parseInline(tokens);
    let safe=null;
    try { const url=new URL(href);if(/^https?:$/.test(url.protocol)&&!/[\u0000-\u0020]/.test(href))safe=url.href; } catch {}
    return safe ? '<a href="'+escape(safe)+'" target="_blank" rel="noopener noreferrer"'+(title?' title="'+escape(title)+'"':'')+'>'+label+'</a>' : '<span class="documentLink" title="'+escape(href)+'">'+label+'</span>';
  };
  renderer.image = ({text}) => '<span class="documentImage">[图片：'+escape(text||'见原文件')+']</span>';
  renderer.code = ({text,lang}) => '<details class="documentCode"><summary>'+(/^(json|ya?ml)$/i.test(lang||'')?'原始数据':'代码或原文片段')+(lang?' · '+escape(lang):'')+'</summary><pre><code>'+escape(text)+'</code></pre></details>';
  renderer.table = function({header,rows}) {
    const labels=header.map(cell=>cell.text.replace(/[*_`]/g,''));
    const head='<thead><tr>'+header.map(cell=>'<th scope="col">'+this.parser.parseInline(cell.tokens)+'</th>').join('')+'</tr></thead>';
    const body='<tbody>'+rows.map(cells=>'<tr>'+cells.map((cell,i)=>'<td data-label="'+escape(labels[i]||'内容')+'">'+this.parser.parseInline(cell.tokens)+'</td>').join('')+'</tr>').join('')+'</tbody>';
    return '<div class="documentTable"><table>'+head+body+'</table></div>';
  };
  const parser=new globalThis.marked.Marked({gfm:true,breaks:false,renderer});
  const plain = tokens => (tokens||[]).map(t=>t.tokens?plain(t.tokens):t.text||'').join('').replace(/\s+/g,' ').trim();
  const groups = [
    {id:'story',title:'剧本与故事',match:/剧本|分镜|立意|情绪空间|情绪.*修|节拍/},
    {id:'shots',title:'镜头与声音',match:/镜头|逐镜|\d+镜|画面任务|旁白|声音|制作交接/},
    {id:'assets',title:'资产与提示词',match:/资产|Prompt|提示词|返修|四视图/i},
    {id:'process',title:'过程与依据',match:/框架|定位|记录|依据|边界|续接|来源|文档说明/}
  ];
  globalThis.ProgressDocument = {
    sections(content,filePath='') {
      if(!/\.md$/i.test(filePath))return [];
      const text=String(content??'').replace(/^\uFEFF/,'').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'');
      try{
        const tokens=parser.lexer(text),headings=tokens.filter(t=>t.type==='heading');
        if(!headings.length)return [];
        let depth=Math.min(...headings.map(t=>t.depth));
        // A single document title is not a chapter. Fenced code and nested lists never create chapters.
        if(headings.filter(t=>t.depth===depth).length===1&&headings.some(t=>t.depth>depth))depth=Math.min(...headings.filter(t=>t.depth>depth).map(t=>t.depth));
        const sections=[];let current={title:'文档说明',tokens:[]};
        for(const token of tokens){
          if(token.type==='heading'&&token.depth===depth){
            if(current.chapter||current.tokens.some(t=>!['space','heading','hr'].includes(t.type)))sections.push(current);
            current={title:plain(token.tokens)||token.text,tokens:[],chapter:true};
          }else current.tokens.push(token);
        }
        if(current.chapter||current.tokens.length)sections.push(current);
        return sections.map((s,i)=>{
          const title=s.title.replace(/^\d+[.、]\s*/,''),paragraph=s.tokens.find(t=>t.type==='paragraph');
          const summary=paragraph?plain(paragraph.tokens):'';
          // This is a title-based reading aid, never an approval, date or current-version inference.
          const group=groups.find(g=>g.match.test(title))||{id:'other',title:'其他章节'};
          return {id:'section-'+i,title,sourceTitle:s.title,groupId:group.id,groupTitle:group.title,summary:summary.length>100?summary.slice(0,100)+'…':summary,content:s.tokens.map(t=>t.raw).join('')};
        });
      }catch{return [];}
    },
    render(content,filePath='') {
      const text=String(content??'').replace(/^\uFEFF/,'');
      if(!/\.md$/i.test(filePath))return '<pre class="documentPlain">'+escape(text)+'</pre>';
      let body=text,metadata='';
      const frontmatter=body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if(frontmatter){body=body.slice(frontmatter[0].length);metadata='<details class="documentMetadata"><summary>文档属性</summary><pre>'+escape(frontmatter[1])+'</pre></details>';}
      try{return metadata+parser.parse(body);}
      catch{return '<p class="traceError">此段暂时无法排版，已保留原文。</p><pre class="documentPlain">'+escape(text)+'</pre>';}
    }
  };
})();
