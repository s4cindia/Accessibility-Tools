/* =========================================================================
   operation.js — drives the four feature operation pages.
   Reads config from #opConfig, handles drag/drop upload, an editable file
   list (multi), sheet detection, Parent ID / output name, processing with a
   loading state, toasts, a sortable/filterable/paginated preview table, and
   per-output download buttons.
   ========================================================================= */
(function () {
  var CFG = JSON.parse(document.getElementById("opConfig").textContent);
  var input = document.getElementById("fileInput");
  var dz = document.getElementById("dropzone");
  var dzText = document.getElementById("dzText");
  var filesTable = document.getElementById("filesTable");
  var filesBody = document.getElementById("filesBody");
  var countPill = document.getElementById("countPill");
  var runBtn = document.getElementById("runBtn");
  var statusBox = document.getElementById("statusBox");
  var sheetSel = document.getElementById("sheetSel");
  var parentInput = document.getElementById("parentId");
  var parentErr = document.getElementById("parentIdErr");

  var files = [];                 // File objects
  var sheetsLoadedFor = null;     // file name we fetched sheets for

  /* ---------- mandatory Parent ID (placeholder 2) ---------- */
  var AXE_SLUG = "generate-axe2-excel";
  // strip a leading 'PSGIN-' prefix to get the numeric id portion the user typed
  function parentCore(){
    return (parentInput ? parentInput.value : "").replace(/^\s*PSGIN\s*-?\s*/i, "").trim();
  }
  // Returns an error message when the Parent ID is invalid, else null.
  function parentIdError(){
    if(!parentInput) return null;
    if(CFG.slug === AXE_SLUG){
      var core = parentCore();
      if(core === "") return "Enter the numeric Parent ID after “PSGIN-”.";
      if(!/^[0-9]+$/.test(core)) return "Parent ID must be numbers only — no letters or symbols.";
      return null;
    }
    if(CFG.requireParentId && parentInput.value.trim() === "") return "Parent ID is required.";
    return null;
  }
  function parentIdOk(){ return parentIdError() === null; }
  function showParentIdError(show){
    if(!parentInput) return;
    parentInput.classList.toggle("invalid", !!show);
    if(parentErr) parentErr.hidden = !show;
  }
  if(parentInput && CFG.requireParentId){
    parentInput.addEventListener("input", function(){
      if(parentIdOk()) showParentIdError(false);   // clear once a value is typed
      renderFiles();                               // keep run button in sync
    });
  }

  /* ---------- helpers ---------- */
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function fmtSize(n){ if(n<1024)return n+" B"; if(n<1048576)return (n/1024).toFixed(1)+" KB";
    return (n/1048576).toFixed(1)+" MB"; }
  function toast(msg, kind){
    var box=document.getElementById("toasts");
    var t=document.createElement("div"); t.className="toast "+(kind||"info"); t.textContent=msg;
    box.appendChild(t); setTimeout(function(){ t.style.opacity="0";
      t.style.transition="opacity .3s"; setTimeout(function(){t.remove();},300); }, 3600);
  }
  function setStatus(kind, html){
    statusBox.className="status show "+kind;
    statusBox.innerHTML=(kind==="working"?'<span class="spinner"></span>':'')+html;
  }
  function clearStatus(){ statusBox.className="status"; statusBox.innerHTML=""; }

  /* ---------- file selection ---------- */
  function renderFiles(){
    if(!files.length){
      filesTable.hidden=true; countPill.hidden=true;
      dzText.textContent="Drag & drop "+(CFG.multiple?"files":"a file")+" here, or click to browse";
      runBtn.disabled=true; return;
    }
    if(CFG.multiple){
      filesTable.hidden=false;
      filesBody.innerHTML=files.map(function(f,i){
        return "<tr><td>"+esc(f.name)+"</td><td>"+fmtSize(f.size)+
          "</td><td><button class='rm' data-i='"+i+"'>Remove</button></td></tr>";
      }).join("");
      countPill.hidden=false;
      countPill.innerHTML="<b>"+files.length+"</b>&nbsp;file"+(files.length>1?"s":"")+" ready to merge";
    } else {
      dzText.textContent=files[0].name+"  ("+fmtSize(files[0].size)+")";
    }
    // The button stays ACTIVE even without a Parent ID — clicking it without one
    // shows a "Parent ID is mandatory" pop-up (handled in the run handler).
    runBtn.disabled=false;
  }

  function addFiles(list){
    var arr=Array.prototype.slice.call(list);
    if(!arr.length) return;
    files = CFG.multiple ? files.concat(arr) : arr.slice(0,1);
    renderFiles();
    if(CFG.needSheet && !CFG.multiple) detectSheets(files[0]);
  }

  filesBody && filesBody.addEventListener("click", function(e){
    var b=e.target.closest(".rm"); if(!b) return;
    files.splice(parseInt(b.dataset.i,10),1); renderFiles();
  });
  input.addEventListener("change", function(){ addFiles(input.files); input.value=""; });
  dz.addEventListener("click", function(){ input.click(); });
  dz.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); input.click(); }});
  ["dragenter","dragover"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.add("drag"); }); });
  ["dragleave","drop"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.remove("drag"); }); });
  dz.addEventListener("drop", function(e){ if(e.dataTransfer&&e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  /* ---------- sheet detection ---------- */
  function detectSheets(file){
    if(!sheetSel || sheetsLoadedFor===file.name) return;
    var fd=new FormData(); fd.append("file", file);
    sheetSel.innerHTML='<option value="">(detecting…)</option>';
    fetch(CFG.sheetsEndpoint,{method:"POST",body:fd})
      .then(function(r){return r.json();})
      .then(function(j){
        sheetsLoadedFor=file.name;
        if(j.ok && j.sheets && j.sheets.length){
          sheetSel.innerHTML='<option value="">(first sheet)</option>'+
            j.sheets.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join("");
        } else {
          sheetSel.innerHTML='<option value="">(single sheet / CSV)</option>';
        }
      })
      .catch(function(){ sheetSel.innerHTML='<option value="">(first sheet)</option>'; });
  }

  /* ---------- run ---------- */
  runBtn.addEventListener("click", function(){
    if(!files.length) return;
    var pidErr = parentIdError();
    if(pidErr){
      showParentIdError(true);
      if(window.Swal){
        Swal.fire({
          icon:"warning",
          title:"Check the Parent ID",
          text:pidErr,
          confirmButtonText:"OK",
          confirmButtonColor:"#0d9488",
        }).then(function(){ if(parentInput) parentInput.focus(); });
      } else {
        setStatus("error","<b>"+esc(pidErr)+"</b>");
        toast(pidErr,"error");
        if(parentInput) parentInput.focus();
      }
      return;
    }
    runBtn.disabled=true;
    document.getElementById("resultCard").hidden=true;
    document.getElementById("previewCard").hidden=true;
    setStatus("working","Processing "+files.length+" file"+(files.length>1?"s":"")+"…");

    var fd=new FormData();
    if(CFG.multiple){ files.forEach(function(f){ fd.append("files",f); }); }
    else { fd.append("file", files[0]); }
    if(CFG.needSheet && sheetSel) fd.append("sheet", sheetSel.value||"");
    if(CFG.needParentId){ var pid=document.getElementById("parentId"); if(pid) fd.append("parent_id", pid.value||""); }
    if(CFG.needOutName){ var on=document.getElementById("outName"); if(on) fd.append("out_name", on.value||""); }

    fetch(CFG.endpoint,{method:"POST",body:fd})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
      .then(function(res){
        var j=res.j;
        if(!res.ok || !j.ok) throw new Error(j.error||"Processing failed.");
        clearStatus();
        toast("Done — your file"+((j.files||[]).length>1?"s are":" is")+" ready","success");
        renderResults(j);
      })
      .catch(function(err){ setStatus("error","<b>Could not process.</b>&nbsp;"+esc(err.message)); toast(err.message,"error"); })
      .finally(function(){ runBtn.disabled=files.length===0; });
  });

  /* ---------- results ---------- */
  function statCards(s){
    var cards=[];
    function add(v,l){ cards.push('<div class="stat"><div class="v">'+v+'</div><div class="l">'+esc(l)+'</div></div>'); }
    if("files_processed" in s){ add(s.files_processed+"/"+s.files_total,"files merged"); add(s.final_rows,"rows in output");
      add(s.duplicates_removed,"duplicates removed"); add(s.columns,"columns"); }
    else if("written" in s){ add(s.written,"rows written"); add(s.wcag_rows,"with WCAG id");
      add(s.matched,"matched in tags"); add(s.severity_rows,"severity mapped");
      add(s.template_used?"Yes":"No","template used"); }
    else if("counts_all" in s){ add(s.matched,"documents"); add(s.counts_all.PDF,"PDF");
      add(s.counts_all["Microsoft Word"],"Word"); add(s.counts_all["Microsoft PowerPoint"],"PowerPoint"); }
    else if("unique_issues" in s){ add(s.unique_issues,"unique issues"); add(s.total_findings,"total findings");
      add(s.criteria_affected,"WCAG criteria"); }
    return cards.join("");
  }
  function breakdownBlock(title, obj){
    if(!obj || !Object.keys(obj).length) return "";
    var chips=Object.keys(obj).map(function(k){ return '<span class="chip">'+esc(k)+' <b>'+obj[k]+'</b></span>'; }).join("");
    return '<div class="breakdown"><h3>'+esc(title)+'</h3><div class="chips">'+chips+'</div></div>';
  }
  function renderResults(j){
    var s=j.stats||{};
    document.getElementById("statGrid").innerHTML=statCards(s);
    var bd="";
    bd+=breakdownBlock("By WCAG criterion", s.by_wcag);
    bd+=breakdownBlock("By severity", s.by_severity);
    bd+=breakdownBlock("By priority", s.by_priority);
    bd+=breakdownBlock("Documents by type", s.by_type);
    if(s.warnings && s.warnings.length) bd+='<div class="breakdown"><h3>Notes</h3><div class="muted">'+s.warnings.map(esc).join("<br>")+'</div></div>';
    document.getElementById("breakdowns").innerHTML=bd;

    var dls=(j.files||[]).map(function(f){
      return '<a class="btn ok" href="'+f.url+'" data-name="'+esc(f.file)+'" download>'+
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
        '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg> '+esc(f.label)+'</a>';
    }).join("");

    // Placeholder 2: when a verify payload is present, the user must check (and
    // fill any empty) Rule ID / Description / Selector / Summary BEFORE the
    // download is offered. We hold the download buttons + auto-save until then.
    var verify = (s.verify && s.verify.columns && s.verify.columns.length) ? s.verify : null;
    var primary = (j.files||[])[0];

    document.getElementById("downloads").innerHTML = verify ? "" : dls;
    document.getElementById("resultCard").hidden=false;

    if(j.preview && j.preview.columns && j.preview.columns.length) buildPreview(j.preview);

    if(verify && primary){
      buildVerify(verify, primary, dls);
    } else {
      document.getElementById("verifyCard").hidden=true;
      // offer the primary (first) output for save-with-rename right away
      if(primary && typeof window.saveFileAs==="function"){
        window.saveFileAs(primary.url, primary.file);
      }
    }
  }

  // Every result download button routes through the rename-and-save helper.
  (function(){
    var box=document.getElementById("downloads");
    if(!box) return;
    box.addEventListener("click", function(e){
      var a=e.target.closest && e.target.closest("a.btn.ok[href]");
      if(!a || typeof window.saveFileAs!=="function") return;   // plain link otherwise
      e.preventDefault();
      window.saveFileAs(a.getAttribute("href"), a.getAttribute("data-name")||"");
    });
  })();

  /* ---------- preview table: sort / filter / paginate ---------- */
  var PV={cols:[],rows:[],filtered:[],page:0,size:25,sortCol:null,sortDir:1};
  function buildPreview(p){
    PV.cols=p.columns; PV.rows=p.rows; PV.filtered=p.rows.slice();
    PV.page=0; PV.sortCol=null; PV.sortDir=1;
    document.getElementById("previewMeta").textContent=
      "· showing "+p.shown+" of "+p.total+" row"+(p.total!==1?"s":"");
    document.getElementById("previewHead").innerHTML="<tr>"+PV.cols.map(function(c){
      return "<th data-c='"+esc(c)+"'>"+esc(c)+"<span class='arr'>↕</span></th>"; }).join("")+"</tr>";
    renderPage();
    document.getElementById("previewCard").hidden=false;
  }
  function renderPage(){
    var start=PV.page*PV.size, slice=PV.filtered.slice(start,start+PV.size);
    document.getElementById("previewBody").innerHTML=slice.map(function(r){
      return "<tr>"+PV.cols.map(function(c){ var v=r[c]; return "<td title='"+esc(v)+"'>"+esc(v)+"</td>"; }).join("")+"</tr>";
    }).join("") || "<tr><td colspan='"+PV.cols.length+"' style='text-align:center;color:#8a93a6;padding:18px'>No matching rows</td></tr>";
    var pages=Math.max(1,Math.ceil(PV.filtered.length/PV.size));
    document.getElementById("pager").innerHTML=
      "<button id='prev' "+(PV.page<=0?"disabled":"")+">Prev</button>"+
      "<span>Page "+(PV.page+1)+" of "+pages+" · "+PV.filtered.length+" rows</span>"+
      "<button id='next' "+(PV.page>=pages-1?"disabled":"")+">Next</button>";
    var pv=document.getElementById("prev"), nx=document.getElementById("next");
    if(pv) pv.onclick=function(){ if(PV.page>0){PV.page--;renderPage();} };
    if(nx) nx.onclick=function(){ if(PV.page<pages-1){PV.page++;renderPage();} };
  }
  document.getElementById("previewFilter").addEventListener("input", function(e){
    var q=e.target.value.toLowerCase().trim();
    PV.filtered = !q ? PV.rows.slice() : PV.rows.filter(function(r){
      return PV.cols.some(function(c){ return String(r[c]==null?"":r[c]).toLowerCase().indexOf(q)>=0; });
    });
    PV.page=0; renderPage();
  });
  document.getElementById("previewHead").addEventListener("click", function(e){
    var th=e.target.closest("th"); if(!th) return;
    var c=th.dataset.c;
    PV.sortDir = (PV.sortCol===c) ? -PV.sortDir : 1; PV.sortCol=c;
    PV.filtered.sort(function(a,b){
      var x=String(a[c]==null?"":a[c]), y=String(b[c]==null?"":b[c]);
      var nx=parseFloat(x), ny=parseFloat(y);
      if(!isNaN(nx)&&!isNaN(ny)) return (nx-ny)*PV.sortDir;
      return x.localeCompare(y)*PV.sortDir;
    });
    PV.page=0; renderPage();
  });

  /* ---------- verify table: edit + fill the 4 key fields, then download ---- */
  var VV={cols:[],fieldCols:{},rows:[],sheet:"",file:null,downloadsHTML:"",
          page:0,size:25,dirty:{}};

  function verifyEmptyCount(){
    var n=0;
    VV.rows.forEach(function(r){
      VV.cols.forEach(function(c){ if(!String(r.values[c]||"").trim()) n++; });
    });
    return n;
  }
  function updateVerifyState(){
    var empties=verifyEmptyCount();
    var btn=document.getElementById("verifyDownloadBtn");
    var note=document.getElementById("verifyStatus");
    btn.disabled = empties>0;
    note.className="verify-note "+(empties>0?"bad":"ok");
    note.textContent = empties>0
      ? (empties+" empty cell"+(empties>1?"s":"")+" — fill "+(empties>1?"them":"it")+" to enable download")
      : "All four fields are filled — ready to download.";
    document.getElementById("verifyMeta").textContent =
      "· "+VV.rows.length+" row"+(VV.rows.length!==1?"s":"")+
      (empties>0?(" · "+empties+" to fix"):" · all good");
  }
  function buildVerify(v, file, downloadsHTML){
    VV.cols=v.columns; VV.fieldCols=v.field_cols||{}; VV.rows=v.rows||[];
    VV.sheet=v.sheet||""; VV.file=file; VV.downloadsHTML=downloadsHTML||"";
    VV.page=0; VV.dirty={};
    document.getElementById("verifyHead").innerHTML="<tr><th class='vrownum'>Row</th>"+
      VV.cols.map(function(c){ return "<th>"+esc(c)+"</th>"; }).join("")+"</tr>";
    renderVerifyPage();
    updateVerifyState();
    document.getElementById("verifyCard").hidden=false;
  }
  function renderVerifyPage(){
    var start=VV.page*VV.size, slice=VV.rows.slice(start,start+VV.size);
    document.getElementById("verifyBody").innerHTML=slice.map(function(r){
      return "<tr data-row='"+r.row+"'><td class='vrownum'>"+r.row+"</td>"+
        VV.cols.map(function(c){
          var v=String(r.values[c]==null?"":r.values[c]);
          var empty=!v.trim();
          return "<td class='vedit"+(empty?" vempty":"")+"' contenteditable='true' "+
            "data-row='"+r.row+"' data-col='"+esc(c)+"' title='"+esc(v)+"'>"+esc(v)+"</td>";
        }).join("")+"</tr>";
    }).join("") || "<tr><td colspan='"+(VV.cols.length+1)+"' style='text-align:center;color:#8a93a6;padding:18px'>No rows</td></tr>";
    var pages=Math.max(1,Math.ceil(VV.rows.length/VV.size));
    document.getElementById("verifyPager").innerHTML=
      "<button id='vprev' "+(VV.page<=0?"disabled":"")+">Prev</button>"+
      "<span>Page "+(VV.page+1)+" of "+pages+" · "+VV.rows.length+" rows</span>"+
      "<button id='vnext' "+(VV.page>=pages-1?"disabled":"")+">Next</button>";
    var pv=document.getElementById("vprev"), nx=document.getElementById("vnext");
    if(pv) pv.onclick=function(){ if(VV.page>0){VV.page--;renderVerifyPage();} };
    if(nx) nx.onclick=function(){ if(VV.page<pages-1){VV.page++;renderVerifyPage();} };
  }
  function findRow(rownum){
    for(var i=0;i<VV.rows.length;i++){ if(VV.rows[i].row===rownum) return VV.rows[i]; }
    return null;
  }
  // Commit an edited cell back into the model + mark it dirty for saving.
  (function(){
    var body=document.getElementById("verifyBody");
    if(!body) return;
    function commit(td){
      var rownum=parseInt(td.dataset.row,10), col=td.dataset.col;
      var rec=findRow(rownum); if(!rec) return;
      var nv=td.textContent.replace(/\s+$/,"");   // trim trailing whitespace/newlines
      if(String(rec.values[col]||"")===nv) { td.classList.toggle("vempty",!nv.trim()); return; }
      rec.values[col]=nv;
      VV.dirty[rownum+":"+col]={row:rownum,col:VV.fieldCols[col]||"",value:nv};
      td.classList.toggle("vempty",!nv.trim());
      td.setAttribute("title",nv);
      updateVerifyState();
    }
    body.addEventListener("input", function(e){ var td=e.target.closest("td.vedit"); if(td){ td.classList.toggle("vempty",!td.textContent.trim()); } });
    body.addEventListener("blur", function(e){ var td=e.target.closest("td.vedit"); if(td) commit(td); }, true);
    body.addEventListener("keydown", function(e){
      if(e.key==="Enter" && !e.shiftKey){ var td=e.target.closest("td.vedit"); if(td){ e.preventDefault(); td.blur(); } }
    });
  })();
  // Confirm & Download: save edits into the workbook, then offer the file.
  (function(){
    var btn=document.getElementById("verifyDownloadBtn");
    if(!btn) return;
    btn.addEventListener("click", function(){
      if(verifyEmptyCount()>0){ toast("Fill every highlighted cell first","error"); return; }
      var edits=Object.keys(VV.dirty).map(function(k){ return VV.dirty[k]; })
                      .filter(function(e){ return e.col; });
      btn.disabled=true;
      var done=function(){
        document.getElementById("downloads").innerHTML=VV.downloadsHTML;
        toast("Verified — your file is ready","success");
        if(VV.file && typeof window.saveFileAs==="function") window.saveFileAs(VV.file.url, VV.file.file);
        VV.dirty={};
        updateVerifyState();
      };
      if(!edits.length){ done(); return; }
      fetch(CFG.verifySaveEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({file:VV.file.file, sheet:VV.sheet, edits:edits})})
        .then(function(r){ return r.json(); })
        .then(function(j){ if(!j.ok) throw new Error(j.error||"Save failed"); done(); })
        .catch(function(err){ toast("Could not save edits: "+err.message,"error"); btn.disabled=false; });
    });
  })();

  renderFiles();
})();
