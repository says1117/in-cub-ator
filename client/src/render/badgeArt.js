// Shared medal artwork for the collection and the victory reveal.
// All details use local coordinates so the same design stays crisp at either size.
const PALETTES = {
  drop: [0x1e4b94, 0x35baff, 0xa5f5ff, 0x786bff],
  sun: [0x8b3826, 0xffa62e, 0xfff49b, 0xff674e],
  leaf: [0x165c50, 0x42d58c, 0xd8ff96, 0x3edbd2],
  spore: [0x533177, 0xb77aff, 0xf6c4ff, 0xff7cc6],
  flower: [0x843765, 0xff7db4, 0xffd7ee, 0xa890ff],
  root: [0x633e2e, 0xdc9453, 0xffdda0, 0x66d6a0],
  bolt: [0x353888, 0x8b96ff, 0xe2f4ff, 0x3fdcf5],
  crown: [0x693563, 0xffc54b, 0xfff3b3, 0xf084dc],
};

export function createBadgeArt(scene, x, y, badge, parent, scale = 1) {
  const medal = scene.add.container(x, y).setScale(scale);
  parent?.add(medal);
  const g = scene.add.graphics(); medal.add(g);
  const [deep, main, light, accent] = PALETTES[badge.motif] || PALETTES.crown;
  const poly = (points, color) => g.fillStyle(color).fillPoints(points.map(([x,y])=>({x,y})), true);
  const line = (points, color=light, width=1) => g.lineStyle(width,color).strokePoints(points.map(([x,y])=>({x,y})),false);
  const jewel = (x,y,size,color) => {
    poly([[x,y-size],[x+size,y],[x,y+size],[x-size,y]],color);
    poly([[x,y-size],[x,y],[x-size,y]],0xffffff);
  };
  // Split velvet ribbons, dark extruded edge, and a bevelled gold frame.
  poly([[-23,16],[-27,38],[-17,33],[-9,40],[-5,20]],deep);
  poly([[23,16],[27,38],[17,33],[9,40],[5,20]],accent);
  line([[-20,22],[-22,31],[-16,28]],main,2);
  line([[20,22],[22,31],[16,28]],light,2);
  g.fillStyle(0x080d24,0.65).fillCircle(1,3,34);
  g.fillStyle(0x6c421f).fillCircle(0,0,33);
  g.fillStyle(0xffcf67).fillCircle(0,-1,32);
  g.fillStyle(0x9c642e).fillCircle(0,1,29);
  g.lineStyle(2,0xfff0ae).strokeCircle(0,-1,30);
  g.fillStyle(deep).fillCircle(0,0,27);
  g.fillStyle(main,0.16).fillCircle(-5,-7,21);
  g.lineStyle(1,accent,0.7).strokeCircle(0,0,25);
  // Engraved outer studs and paired laurel leaves.
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6;
    g.fillStyle(i%2?0xffeeaf:0xcb8b43).fillCircle(Math.cos(a)*30,Math.sin(a)*30,1.1);
  }
  for(const side of [-1,1]) {
    line([[side*8,23],[side*18,18],[side*23,7],[side*22,-8]],0xdbac58,1);
    for(let i=0;i<5;i++) {
      const y=17-i*6,x=side*(19+Math.sin(i*.7)*3);
      poly([[x,y+3],[x+side*4,y-1],[x+side*1,y-4],[x-side*3,y]],i%2?0xf8dd83:0xb88636);
    }
  }
  // Each emblem has shaded facets, highlights and a contrasting secondary color.
  switch(badge.motif) {
    case 'drop':
      poly([[0,-21],[-13,0],[-12,10],[-6,16],[4,17],[12,10],[13,0]],deep);
      poly([[0,-21],[-11,1],[-10,9],[-4,14],[5,14],[11,7],[10,0]],main);
      poly([[0,-18],[-8,1],[-6,8],[-3,9],[-3,0]],light);
      g.lineStyle(2,accent).strokeEllipse(0,18,25,5); g.fillStyle(0xffffff).fillCircle(6,7,2); break;
    case 'sun':
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4,dx=Math.cos(a),dy=Math.sin(a),px=-dy,py=dx;
        poly([[dx*12+px*3,dy*12+py*3],[dx*22,dy*22],[dx*12-px*3,dy*12-py*3]],i%2?accent:light);
      }
      g.fillStyle(deep).fillCircle(1,1,13); g.fillStyle(main).fillCircle(0,0,12);
      g.lineStyle(2,light).strokeCircle(-1,-1,10); g.fillStyle(0xffef94).fillCircle(-3,-3,6);
      g.fillStyle(0xffffff).fillCircle(-5,-5,2); break;
    case 'leaf':
      poly([[-3,18],[-14,8],[-14,-3],[-7,-14],[13,-20],[15,-1],[9,11]],main);
      poly([[-3,18],[0,-3],[13,-20],[15,-1],[9,11]],accent);
      line([[-4,20],[0,2],[12,-17]],light,2);
      line([[0,2],[-10,-2]],light);line([[4,-5],[-5,-9]],light);line([[1,6],[10,1]],light);
      g.fillStyle(0xb5f5ff).fillEllipse(-8,7,4,6);break;
    case 'spore':
      poly([[-5,-1],[-6,17],[5,17],[4,-1]],light);
      g.fillStyle(main).fillEllipse(0,-5,35,24);
      g.fillStyle(deep).fillEllipse(0,1,35,7);
      g.lineStyle(2,light).strokeEllipse(0,-6,33,21);
      for(const [x,y,r] of [[-9,-7,3],[5,-12,3],[10,-3,2]]) {g.fillStyle(accent).fillCircle(x,y,r+1);g.fillStyle(light).fillCircle(x-1,y-1,r-1);}
      line([[-2,6],[-2,14]],0xb77aff,2);break;
    case 'flower':
      for(let i=0;i<6;i++) {
        const a=i*Math.PI/3,x=Math.cos(a)*12,y=Math.sin(a)*12;
        g.fillStyle(deep).fillCircle(x+1,y+1,9);g.fillStyle(i%2?accent:main).fillCircle(x,y,8);
        g.fillStyle(light,0.75).fillCircle(x-2,y-2,3);
      }
      g.fillStyle(0xb77626).fillCircle(0,0,8);g.fillStyle(0xffd65e).fillCircle(0,-1,6);
      for(const [x,y] of [[-2,-3],[2,-1],[0,2]])g.fillStyle(0xfff5b5).fillCircle(x,y,1);break;
    case 'root':
      poly([[-4,-12],[4,-12],[5,2],[13,11],[17,20],[9,15],[1,8],[-1,20],[-6,13],[-14,20],[-11,10],[-4,3]],main);
      line([[-1,-9],[-1,3],[9,14]],light,2);line([[-1,4],[-8,12]],light);
      g.fillStyle(accent).fillEllipse(-7,-14,15,9).fillEllipse(7,-19,15,9);
      line([[0,-8],[0,-19],[9,-21]],light);break;
    case 'bolt':
      poly([[6,-22],[-15,5],[-2,5],[-6,22],[17,-7],[3,-7]],accent);
      poly([[5,-19],[-10,2],[3,2],[-3,18],[13,-4],[0,-4]],light);
      line([[-17,-14],[-21,-7],[-16,-3]],main,2);line([[17,9],[21,14],[16,21]],main,2);break;
    default:
      poly([[-20,-13],[-10,-2],[0,-19],[10,-2],[20,-13],[15,13],[-15,13]],0xb9752e);
      poly([[-18,-13],[-9,0],[0,-17],[9,0],[18,-13],[13,9],[-13,9]],main);
      g.fillStyle(light).fillRoundedRect(-15,9,30,6,2);
      jewel(0,2,4,accent);jewel(-10,4,2,0x58dfff);jewel(10,4,2,0x58dfff);
      for(const [x,y] of [[-19,-13],[0,-19],[19,-13]])g.fillStyle(light).fillCircle(x,y,2);break;
  }
  // A rank jewel changes hue with progression; extra studs mark higher ranks.
  const rank = Math.max(1,Number(badge.rank)||1);
  jewel(0,29,4,rank%2?accent:main);
  for(let i=0;i<Math.min(rank,5);i++)g.fillStyle(0xfff1b0).fillCircle((i-(Math.min(rank,5)-1)/2)*4,-29,1);
  return medal;
}

export function animateBadgeEarned(scene, parent, badge, x, y, scale=2, reducedMotion=false) {
  const reveal=scene.add.container(x,y);parent.add(reveal);
  const halo=scene.add.graphics();reveal.add(halo);
  const colors=[0xffd77a,0x9af4ff,0xff92cc,0xbb9dff];
  for(let i=0;i<4;i++)halo.fillStyle(colors[i],0.045).fillCircle(0,0,(56-i*9)*scale);
  const rays=scene.add.graphics();reveal.add(rays);
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6;
    rays.fillStyle(colors[i%4],0.18).fillPoints([
      {x:Math.cos(a-.07)*34*scale,y:Math.sin(a-.07)*34*scale},
      {x:Math.cos(a)*68*scale,y:Math.sin(a)*68*scale},
      {x:Math.cos(a+.07)*34*scale,y:Math.sin(a+.07)*34*scale}],true);
  }
  const medal=createBadgeArt(scene,0,0,badge,reveal,scale);
  reveal.setData('badgeId',badge.id);
  if(reducedMotion) {
    rays.setVisible(false);reveal.setAlpha(0);
    scene.tweens.add({targets:reveal,alpha:1,duration:250});return reveal;
  }
  medal.setScale(scale*.12).setAngle(-24).setAlpha(0);
  halo.setAlpha(0);rays.setAlpha(0);
  scene.tweens.add({targets:medal,scale,angle:0,alpha:1,delay:160,duration:750,ease:'Back.easeOut'});
  scene.tweens.add({targets:halo,alpha:1,delay:240,duration:650});
  scene.tweens.add({targets:rays,alpha:1,angle:35,delay:340,duration:1800,ease:'Sine.easeOut'});
  // Colored gem sparks fly out as the medal settles into place.
  for(let i=0;i<20;i++) {
    const a=i*Math.PI*2/20,dist=(45+(i%4)*9)*scale;
    const spark=scene.add.star(0,0,4,1.5,4,colors[i%4]).setAlpha(0);reveal.add(spark);
    scene.tweens.add({targets:spark,x:Math.cos(a)*dist,y:Math.sin(a)*dist,angle:i*27,
      alpha:{from:1,to:0},scale:{from:1.2,to:.2},delay:650+i%3*60,duration:950,
      ease:'Cubic.easeOut',onComplete:()=>spark.destroy()});
  }
  scene.tweens.add({targets:medal,y:-5,delay:1000,duration:1300,yoyo:true,repeat:1,ease:'Sine.easeInOut'});
  return reveal;
}
