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
  globalThis.ProgressDocument = {
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

