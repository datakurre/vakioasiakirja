-- l3build configuration for the sfs-2487-2024 class.
-- See .claude/skills/latex-packaging.md for the release workflow.

module = "sfs-2487-2024"

-- Plain-.cls workflow: nothing to unpack, install the class as-is.
sourcefiles  = {"sfs-2487-2024.cls"}
installfiles = {"*.cls"}
unpackfiles  = {}

-- Documentation and demos. Only the invented examples ship as demos;
-- esimerkki-poytakirja and esimerkki-tarjous replicate the SFS standard's
-- own model documents (Liite A/B) and must stay out of the package, as
-- must the proprietary SFS-2487-2024.pdf spec.
typesetfiles = {"sfs-2487-2024-doc.tex"}
demofiles    = {
  "examples/latex/esimerkki-kokouskutsu.tex",
  "examples/latex/esimerkki-raportti.tex",
  "examples/latex/esimerkki-kayttoohje.tex",
  "examples/logo-organisaatio.tex",
  "examples/logo-suoja-alue.tex",
}
textfiles    = {"README.md", "LICENSE"}

-- Build a TDS zip alongside the CTAN zip.
packtdszip = true

-- nix's TeX Live wrappers locate texmf.cnf through a TEXMFCNF default baked
-- into each bin wrapper; l3build runs typesetting with TEXMFCNF=.: which
-- drops it and leaves pdflatex without its format file. Resolve the real
-- value up front and re-apply it around the typeset command.
if os.type ~= "windows" then
  local kpse = io.popen("kpsewhich --var-value=TEXMFCNF 2>/dev/null")
  if kpse then
    local texmfcnf = kpse:read("*l")
    kpse:close()
    if texmfcnf and texmfcnf ~= "" then
      typesetexe = "env TEXMFCNF='.:" .. texmfcnf .. "' pdflatex"
    end
  end
end

-- Keep version and date in sync via `l3build tag <version>`.
tagfiles = {"sfs-2487-2024.cls", "sfs-2487-2024-doc.tex"}
function update_tag(file, content, tagname, tagdate)
  local texdate = string.gsub(tagdate, "%-", "/")
  if string.match(file, "%.cls$") then
    content = string.gsub(content,
      "\\def\\sfs@filedate{%d%d%d%d/%d%d/%d%d}",
      "\\def\\sfs@filedate{" .. texdate .. "}")
    content = string.gsub(content,
      "\\def\\sfs@fileversion{[^}]*}",
      "\\def\\sfs@fileversion{" .. tagname .. "}")
  elseif string.match(file, "%-doc%.tex$") then
    content = string.gsub(content,
      "\\def\\clsdate{%d%d%d%d/%d%d/%d%d}",
      "\\def\\clsdate{" .. texdate .. "}")
    content = string.gsub(content,
      "\\def\\clsversion{[^}]*}",
      "\\def\\clsversion{" .. tagname .. "}")
  end
  return content
end

-- Ready for the (manual, later) CTAN submission; `version` is passed on
-- the command line: `l3build upload <version>`.
uploadconfig = {
  pkg      = module,
  author   = "Asko Soukka",
  uploader = "Asko Soukka",
  email    = "asko.soukka@iki.fi",
  license  = "mit",
  summary  = "Finnish standard office documents per SFS 2487:2024",
  ctanPath = "/macros/latex/contrib/sfs-2487-2024",
  topic    = {"class", "std-conform"},
  -- repository = "https://github.com/...",  -- once public
  -- update = true,                          -- after the first upload
}
