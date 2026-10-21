"""User's mean-RGB / displayed-sRGB luminance metric, not physical radiance.
Fixed crops are explicitly recorded; different worlds do not imply pixel parity.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np, json, colorsys
root=Path(__file__).resolve().parents[2]
out=root/'evidence/cromos/delivery'
reference=Path('C:/Users/Mohamed/AppData/Local/Temp/codex-clipboard-72770459-8322-42dd-96b0-41c7337ce3fb.png')
def stats(path,box):
    im=Image.open(path).convert('RGB'); x,y,w,h=box
    a=np.asarray(im.crop((x,y,x+w,y+h)),dtype=float)
    rgb=a.mean(axis=(0,1)); l=(a*np.array([.2126,.7152,.0722])).sum(axis=2)/255
    hue=colorsys.rgb_to_hsv(*(rgb/255))[0]*360
    return dict(box=box,rgb=np.rint(rgb).astype(int).tolist(),luma=round(float(l.mean()),3),sat=round(float((rgb.max()-rgb.min())/max(rgb.max(),1)),2),std=round(float(l.std()),3),glintPct=round(float((l>.92).mean()*100),2),hue=round(hue,1))
regions={
 'reference':(reference,{'submerged-sand':[280,400,115,110],'mid-water':[500,315,170,80],'far-water':[550,280,160,30],'dry-sand':[100,530,60,30]}),
 'shelf':(out/'02-floor-closeup.png',{'submerged-sand':[400,680,220,180],'mid-water':[1450,340,220,160],'far-water':[1610,205,220,75],'dry-sand':[275,70,260,100]}),
 'horizon':(out/'08-horizon.png',{'mid-water':[1000,540,300,160],'far-water':[400,270,250,80]}),
}
report={'metric':'Mean RGB, displayed-sRGB luminance, saturation of mean RGB, luminance standard deviation, percent above .92; matches supplied stats().','limitation':'Crops differ in depth, geometry, plant coverage and lighting. No score or parity claim.','regions':{}}
for name,(path,boxes) in regions.items():
    report['regions'][name]={k:stats(path,b) for k,b in boxes.items()}
    im=Image.open(path).convert('RGB');d=ImageDraw.Draw(im)
    for k,(x,y,w,h) in boxes.items():d.rectangle((x,y,x+w,y+h),outline='#ffcc00',width=2);d.text((x+3,y+3),k,fill='#ffcc00')
    im.save(out/(name+'-measurement-crops.png'))
(out/'stats.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
