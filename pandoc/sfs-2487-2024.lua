-- Pandoc Lua filter for sfs-2487-2024.cls — SFS 2487:2024 vakioasiakirja.
--
-- Maps markdown conventions to the class's body commands:
--   definition lists            -> \marginlabel{term} + content
--   ::: {.marginlabel label=""} -> \marginlabel for content a definition
--                                  list cannot hold (e.g. nested lists)
--   ::: esignatures             -> esignatures environment + \esignee
--   ::: handsignature           -> \handsignature{line} per line
-- and validates frontmatter (doctype/title required, logo image paths
-- wrapped in \includegraphics, the features list expanded into per-feature
-- booleans, at most three heading levels). SVG images (logo or body) are
-- converted to PDF with rsvg-convert, which the nix flake provides;
-- pdflatex cannot read SVG directly.

-- Render inlines as LaTeX so special characters survive the trip into
-- raw \marginlabel/\esignee arguments.
local function tex(inlines)
  return pandoc.write(pandoc.Pandoc({pandoc.Plain(inlines)}), 'latex')
    :gsub('%s+$', '')
end

local function texstr(s)
  return tex({pandoc.Str(s)})
end

local function rawblock(fmt, ...)
  return pandoc.RawBlock('latex', fmt:format(...))
end

-- Image paths resolve against the markdown file's directory. A missing
-- file would only surface later as a pdflatex error that latexmk's quiet
-- mode reduces to unrelated undefined-reference noise, so fail early.
local function check_image_exists(src)
  local f = io.open(src, 'r')
  if not f then
    error(('sfs-2487-2024: kuvatiedostoa ei löydy ' ..
           '(image file not found): %s\n'):format(src))
  end
  f:close()
end

-- pdflatex can include these formats (SVG after rsvg-convert). Anything
-- else — say the TikZ .tex source of a logo instead of its built .pdf —
-- would fail inside pdflatex, so reject it with a clear message.
local image_formats = {
  pdf = true, eps = true, png = true, jpg = true, jpeg = true, svg = true,
}

local function image_format(src)
  return src:lower():match('%.(%w+)$')
end

local function check_image_format(src)
  local ext = image_format(src)
  if ext and not image_formats[ext] then
    error(('sfs-2487-2024: kuvamuotoa .%s ei tueta (unsupported image ' ..
           'format): %s — tuetut muodot (supported formats): ' ..
           'pdf, png, jpg, eps, svg\n'):format(ext, src))
  end
end

-- Convert an SVG to PDF next to the build's other temporary files (the
-- flake exports SFS_2487_TMPDIR; standalone pandoc runs fall back to the
-- working directory, which is the markdown file's directory).
local function svg_to_pdf(src)
  local out = pandoc.path.join({
    os.getenv('SFS_2487_TMPDIR') or '.',
    pandoc.utils.sha1(src) .. '.pdf'})
  local ok, err = pcall(pandoc.pipe, 'rsvg-convert',
    {'--format=pdf', '--output=' .. out, src}, '')
  if not ok then
    error(('sfs-2487-2024: SVG-kuvan muunnos PDF:ksi epäonnistui ' ..
           '(rsvg-convert failed for) %s:\n%s\n'):format(src, tostring(err)))
  end
  return out
end

-- Split inlines on hard line breaks (trailing backslash in markdown).
local function lines_of(inlines)
  local lines, line = pandoc.List(), pandoc.List()
  for _, inline in ipairs(inlines) do
    if inline.t == 'LineBreak' then
      lines:insert(line)
      line = pandoc.List()
    else
      line:insert(inline)
    end
  end
  if #line > 0 then lines:insert(line) end
  return lines
end

-- Optional features come in a single frontmatter list; the template cannot
-- test list membership, so expand the tokens into per-feature sfs-* booleans
-- the template reads. A 'no-' prefix turns a feature off. endmatter-newpage,
-- runin and gap default the way the class itself does: endmatter-newpage is
-- off (the end matter flows on after the body, separated only by a paragraph
-- gap — never forcing a page break unless the document opts in with
-- features: [endmatter-newpage]); runin is on (the class runs body text into
-- the heading line, so the feature only carries a 'no-runin' opt-out); gap is
-- on (block paragraph style, so the feature only carries a 'no-gap' opt-out
-- that switches to the compact run-on style).
local feature_names = pandoc.List(
  {'agenda', 'toc', 'endmatter-newpage', 'runin', 'gap'})

local function parse_features(meta)
  for _, name in ipairs(feature_names) do
    if meta[name] ~= nil then
      error(("sfs-2487-2024: metatieto '%s:' on korvattu features-" ..
             "luettelolla (top-level key replaced by the features list): " ..
             "kirjoita (write) features: [%s] tai (or) features: [no-%s]\n")
            :format(name, name, name))
    end
  end
  local features = {}
  if meta.features ~= nil then
    local list = meta.features
    -- A bare scalar (features: agenda) arrives as MetaInlines, not MetaList.
    if pandoc.utils.type(list) ~= 'List' then list = pandoc.List({list}) end
    for _, item in ipairs(list) do
      local token = pandoc.utils.stringify(item)
      local name = token:match('^no%-(.+)$') or token
      if not feature_names:includes(name) then
        error(("sfs-2487-2024: tuntematon ominaisuus (unknown feature) " ..
               "'%s' — tuetut (supported): agenda, toc, endmatter-newpage, " ..
               "runin, gap; no-etuliite poistaa käytöstä (a no- prefix " ..
               "disables one)\n")
              :format(token))
      end
      features[name] = (name == token)
    end
  end
  if features['endmatter-newpage'] == nil then
    features['endmatter-newpage'] = false
  end
  if features['runin'] == nil then features['runin'] = true end
  if features['gap'] == nil then features['gap'] = true end
  for _, name in ipairs(feature_names) do
    meta['sfs-' .. name] = pandoc.MetaBool(features[name] or false)
  end
end

function Meta(meta)
  for _, field in ipairs({'doctype', 'title'}) do
    if meta[field] == nil then
      error(("sfs-2487-2024: pakollinen metatieto '%s' puuttuu " ..
             "(required frontmatter field is missing)\n"):format(field))
    end
  end
  -- logo: an image path becomes \includegraphics, anything else stays
  -- markdown text; done here so pandoc's markdown escaping cannot mangle
  -- the filename.
  if meta.logo then
    local logo = pandoc.utils.stringify(meta.logo)
    if image_formats[image_format(logo) or ''] then
      check_image_exists(logo)
      if image_format(logo) == 'svg' then
        logo = svg_to_pdf(logo)
      end
      meta.logo = pandoc.MetaInlines({
        pandoc.RawInline('latex', '\\includegraphics{' .. logo .. '}')})
    else
      -- A value naming an existing file was meant as an image, not as
      -- markdown text for the logo area, so its format must be usable.
      local f = io.open(logo, 'r')
      if f then
        f:close()
        check_image_format(logo)
      end
    end
  end
  parse_features(meta)
  return meta
end

function Header(header)
  if header.level > 3 then
    error("sfs-2487-2024: SFS 2487:2024 suosittaa enintään kolmea " ..
          "otsikkotasoa (at most three heading levels): '" ..
          pandoc.utils.stringify(header.content) .. "'\n")
  end
end

-- Definition lists: term at the left margin, content at the body indent.
function DefinitionList(dl)
  local blocks = pandoc.List()
  for _, item in ipairs(dl.content) do
    local term, definitions = item[1], item[2]
    blocks:insert(rawblock('\\marginlabel{%s}', tex(term)))
    for _, definition in ipairs(definitions) do
      blocks:extend(definition)
    end
  end
  return blocks
end

local function esignatures(div)
  local list
  for _, block in ipairs(div.content) do
    if block.t == 'BulletList' then list = block end
  end
  if not list then
    error('sfs-2487-2024: esignatures-lohkossa pitää olla luettelo ' ..
          'allekirjoittajista (needs a bullet list of signees)\n')
  end
  local blocks = pandoc.List({rawblock('\\begin{esignatures}')})
  for _, item in ipairs(list.content) do
    local email
    local name = pandoc.List()
    for _, inline in ipairs(pandoc.utils.blocks_to_inlines(item)) do
      if inline.t == 'Link' and inline.target:match('^mailto:') then
        email = inline.target:gsub('^mailto:', '')
      else
        name:insert(inline)
      end
    end
    if not email then
      error('sfs-2487-2024: esignatures-allekirjoittajalta puuttuu ' ..
            'sähköpostiosoite <user@example.com> (signee is missing ' ..
            'an email autolink)\n')
    end
    blocks:insert(rawblock('\\esignee{%s}{%s}',
      tex(name):gsub('[%s,]*$', ''), texstr(email)))
  end
  blocks:insert(rawblock('\\end{esignatures}'))
  return blocks
end

local function handsignature(div)
  local blocks = pandoc.List()
  for _, block in ipairs(div.content) do
    if block.t == 'Para' or block.t == 'Plain' then
      for _, line in ipairs(lines_of(block.content)) do
        blocks:insert(rawblock('\\handsignature{%s}', tex(line)))
      end
    end
  end
  return blocks
end

local function marginlabel(div)
  local label = div.attributes.label
  if not label then
    error('sfs-2487-2024: marginlabel-lohkosta puuttuu label="…" ' ..
          '(div is missing the label attribute)\n')
  end
  local blocks = pandoc.List({rawblock('\\marginlabel{%s}', texstr(label))})
  blocks:extend(div.content)
  return blocks
end

function Div(div)
  if div.classes:includes('esignatures') then return esignatures(div) end
  if div.classes:includes('handsignature') then return handsignature(div) end
  if div.classes:includes('marginlabel') then return marginlabel(div) end
end

-- Body images may be SVG too; pdflatex needs them converted. Extensionless
-- names are left for graphicx to resolve (it searches TEXINPUTS as well).
function Image(image)
  if image_format(image.src) then
    check_image_format(image.src)
    check_image_exists(image.src)
  end
  if image.src:lower():match('%.svg$') then
    image.src = svg_to_pdf(image.src)
    return image
  end
end

-- Captioned images stay in the text flow (6.5.2): no floating figure
-- environment, caption in the figure's immediate proximity.
function Figure(figure)
  local blocks = pandoc.List()
  local content = figure.content
  -- The image belongs at the text indent (6.5.2), so it must not take the
  -- run-in paragraph indent; \noindent the block that carries it.
  if content[1] and content[1].content then
    content[1].content:insert(1, pandoc.RawInline('latex', '\\noindent '))
  end
  blocks:extend(content)
  blocks:insert(rawblock('\\nopagebreak\\captionof{figure}{%s}',
    tex(pandoc.utils.blocks_to_inlines(figure.caption.long))))
  return blocks
end

-- Finnish quotation marks: ” on both sides, ’ for inner quotes (pandoc's
-- smart quotes would produce the English “ ”).
function Quoted(quoted)
  local mark = quoted.quotetype == 'SingleQuote' and '’' or '”'
  local inlines = pandoc.List({pandoc.Str(mark)})
  inlines:extend(quoted.content)
  inlines:insert(pandoc.Str(mark))
  return inlines
end
