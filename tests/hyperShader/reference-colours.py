"""Rendered sRGB reference measurements, not inferred lux or light temperature.
Boxes are normalized to the supplied original-resolution images and exclude UI.
"""
from PIL import Image, ImageDraw
import colorsys, json, statistics
from pathlib import Path

root = Path(__file__).resolve().parents[2]
out = root / 'evidence/reference-colours'
out.mkdir(parents=True, exist_ok=True)
tmp = Path('C:/Users/Mohamed/AppData/Local/Temp')
sources = {
 'reference-torch': ('102853ba-0cab-4e27-a563-38db6ba3649d', {
   'lit-sand': (.22,.56,.40,.72), 'near-torch-sand': (.43,.59,.55,.73),
   'dark-sand': (.09,.39,.19,.46), 'flame-core': (.495,.505,.505,.53)}),
 'reference-day': ('5f611b40-b5c3-494c-8c1f-90459fc76e7a', {
   'blue-sky': (.22,.06,.42,.16), 'sand': (.56,.335,.585,.35),
   'shallow-water': (.18,.53,.32,.65), 'deep-water': (.65,.44,.82,.58)}),
 'current-night': ('1116ab64-44a7-44fc-8476-1790a501c86e', {
   'lit-sand': (.46,.49,.51,.54), 'night-grass': (.17,.53,.30,.65)}),
 'current-menu': ('49fb6c8a-0f5f-4f77-85ee-beec196f3c8b', {
   'grass': (.07,.70,.24,.86)})
}
report = {'convention':'Median rendered 8-bit sRGB and relative luminance after sRGB decoding. Different scenes/exposures cannot establish physical light intensity.', 'sources':{}}
panels=[]
for name,(suffix,boxes) in sources.items():
 im=Image.open(tmp/f'codex-clipboard-{suffix}.png').convert('RGB')
 entry={'sourceSize':im.size,'regions':{}}
 for region,box in boxes.items():
  xy=tuple(round(v*im.size[i%2]) for i,v in enumerate(box))
  pixels=list(im.crop(xy).getdata())
  rgb=[round(statistics.median(p[c] for p in pixels),2) for c in range(3)]
  linear=[v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4 for v in rgb]
  h,l,s=colorsys.rgb_to_hls(*(v/255 for v in rgb))
  entry['regions'][region]={'boxPixels':xy,'medianRGB':rgb,'hueDegrees':round(h*360,1),'saturation':round(s,3),'relativeLuminance':round(sum(a*b for a,b in zip(linear,[.2126,.7152,.0722])),4),'redBlueRatio':round(rgb[0]/max(1,rgb[2]),3)}
  tile=Image.new('RGB',(460,210),'#17202a');tile.paste(im.crop(xy).resize((270,170)),(0,40))
  d=ImageDraw.Draw(tile);d.text((8,8),f'{name} / {region}',fill='white');d.rectangle((290,50,440,120),fill=tuple(round(v) for v in rgb));d.text((290,140),str(rgb),fill='white');panels.append(tile)
 report['sources'][name]=entry
sheet=Image.new('RGB',(920,((len(panels)+1)//2)*210),'#17202a')
for i,p in enumerate(panels):sheet.paste(p,((i%2)*460,(i//2)*210))
sheet.save(out/'samples.png');(out/'measurements.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
