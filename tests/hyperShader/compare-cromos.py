"""Side-by-side reference evidence. Crops are labelled and never retouched.
Different worlds/cameras are NOT pixel parity; metrics describe selected areas.
"""
from PIL import Image,ImageDraw,ImageFilter
import numpy as np,json,colorsys
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=root/'evidence/cromos/comparison';out.mkdir(parents=True,exist_ok=True)
ref=Image.open('C:/Users/Mohamed/AppData/Local/Temp/codex-clipboard-72770459-8322-42dd-96b0-41c7337ce3fb.png').convert('RGB')
game=Image.open(root/'evidence/cromos/visual/03-jungle-shore-detail.png').convert('RGB')
def crop(im,b):return im.crop(tuple(round(v*im.size[i%2]) for i,v in enumerate(b)))
refDetail=crop(ref,(.15,.48,.59,.97));gameDetail=crop(game,(.05,.55,.72,.98))
def fit(im,w,h):
 image=im.copy();image.thumbnail((w,h));panel=Image.new('RGB',(w,h),'#101b24');panel.paste(image,((w-image.width)//2,(h-image.height)//2));return panel
sheet=Image.new('RGB',(1600,1110),'#101b24');d=ImageDraw.Draw(sheet)
d.text((22,12),'SUPPLIED CROMOS REFERENCE',fill='white');d.text((822,12),'ACTUAL OPUSCRAFT / HYPERSHADER',fill='white')
sheet.paste(fit(ref,780,485),(10,40));sheet.paste(fit(game,780,485),(810,40))
d.text((22,540),'Reference: shallow sand, plants, broken highlights',fill='white');d.text((822,540),'Game: real generated sand shelf, 3 water blocks deep',fill='white')
sheet.paste(fit(refDetail,780,470),(10,570));sheet.paste(fit(gameDetail,780,470),(810,570))
d.text((22,1062),'Unretouched crops. Different geometry, textures, camera and lighting; this is visual comparison, not pixel parity.',fill='white')
sheet.save(out/'reference-vs-game.png')
def stats(im,box):
 c=crop(im,box);a=np.asarray(c,dtype=float);rgb=np.median(a,axis=(0,1));h,l,s=colorsys.rgb_to_hls(*(rgb/255))
 g=np.asarray(c.resize((240,160)).convert('L'),dtype=float);low=np.asarray(c.resize((240,160)).convert('L').filter(ImageFilter.GaussianBlur(3)),dtype=float)
 return {'boxNormalized':box,'medianRGB':rgb.round(1).tolist(),'hueDegrees':round(h*360,1),'saturation':round(s,3),'localDetailRms':round(float(np.sqrt(np.mean((g-low)**2))),2)}
report={'limitation':'Selected foreground water patches have different geometry, plant coverage, depth path, lighting and texture details. Do not interpret RGB or detail RMS as a parity percentage.','reference':stats(ref,(.26,.59,.47,.84)),'game':stats(game,(.18,.76,.37,.92)),'referenceSourceSize':ref.size,'gameSourceSize':game.size,'gameCamera':json.loads((root/'evidence/cromos/visual/report.json').read_text())['scenes'][2]}
(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
