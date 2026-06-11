-- Pandoc Lua filter for sfs-2487-2024.cls — SFS 2487:2024 vakioasiakirja.
--
-- Maps markdown conventions to the class's body commands:
--   definition lists            -> \marginlabel{term} + content
--   ::: {.marginlabel label=""} -> \marginlabel for content a definition
--                                  list cannot hold (e.g. nested lists)
--   ::: esignatures             -> esignatures environment + \esignee
--   ::: handsignature           -> \handsignature{name}{role}
-- and validates frontmatter (doctype/title required, logo image paths
-- wrapped in \includegraphics, at most three heading levels).

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
    if logo:lower():match('%.pdf$') or logo:lower():match('%.eps$')
        or logo:lower():match('%.png$') or logo:lower():match('%.jpe?g$') then
      meta.logo = pandoc.MetaInlines({
        pandoc.RawInline('latex', '\\includegraphics{' .. logo .. '}')})
    end
  end
  -- The pöytäkirja model document starts its end matter on a fresh page;
  -- contact info alone stays inline (tarjous model document). Frontmatter
  -- endmatter-newpage overrides either way.
  if meta['endmatter-newpage'] == nil then
    meta['endmatter-newpage'] = pandoc.MetaBool(
      meta.attachments ~= nil or meta.distribution ~= nil
        or meta.forinformation ~= nil)
  end
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
        local signee = tex(line)
        local name, role = signee:match('^(.+),%s*(.+)$')
        if not name then
          error('sfs-2487-2024: handsignature-rivin pitää olla muotoa ' ..
                "'Nimi, rooli' (expected 'Name, role'): '" .. signee .. "'\n")
        end
        blocks:insert(rawblock('\\handsignature{%s}{%s}', name, role))
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

-- Captioned images stay in the text flow (6.5.2): no floating figure
-- environment, caption in the figure's immediate proximity.
function Figure(figure)
  local blocks = pandoc.List()
  blocks:extend(figure.content)
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
