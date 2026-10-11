import Phaser from "phaser";
import { drawCareForest, carePanel, hoverControl } from "../theme/plantCareTheme.js";
import { FONT } from "../ui/font.js";
import { createBadgeArt } from "../render/badgeArt.js";
import { API_URL } from "../config.js";

export default class CollectionScene extends Phaser.Scene {
  constructor() { super("CollectionScene"); }
  label(x,y,text,size=16,color="#f6ecd2") {
    return this.add.text(x,y,text,{fontFamily:FONT,fontSize:`${size}px`,color});
  }
  button(x,y,text,action) {
    const panel=carePanel(this,x-56,y-18,112,36);
    const label=this.label(x,y,text).setOrigin(0.5).setInteractive({useHandCursor:true});
    hoverControl(this,label,{x:x-56,y:y-18,width:112,height:36});
    label.setData("panel",panel);
    label.on("pointerdown",action); return label;
  }
  create() {
    drawCareForest(this);
    carePanel(this,180,13,440,55);
    this.label(400,40,"BADGE COLLECTION",28,"#ffd77a").setOrigin(0.5);
    this.button(720,40,"< BACK",()=>this.registry.get("navigate")("/adventure"));
    this.page=0; this.badges=[]; this.signature="";
    this.content=this.add.container();
    this.status=this.label(400,84, "Loading collection…").setOrigin(0.5);
    this.pageLabel=this.label(400,423,"").setOrigin(0.5);
    this.prev=this.button(270,423,"< PREV",()=>{this.page--;this.render();});
    this.next=this.button(530,423,"NEXT >",()=>{this.page++;this.render();});
    const update=(_parent,key,value)=>{if(key==="serverState" && value?.badges) this.accept(value.badges);};
    this.registry.events.on("changedata",update);
    this.registry.events.on("setdata",update);
    const controller=new AbortController();
    this.events.once("shutdown",()=>{controller.abort();this.registry.events.off("changedata",update);this.registry.events.off("setdata",update);});
    const state=this.registry.get("serverState");
    if(state?.badges) this.accept(state.badges);
    const initialSignature=this.signature;
    fetch(`${API_URL}/api/collection`,{signal:controller.signal,cache:"no-store"})
      .then(r=>{if(!r.ok)throw new Error("Collection unavailable");return r.json();})
      .then(data=>{if(!controller.signal.aborted && this.signature===initialSignature)this.accept(data.badges);})
      .catch(error=>{if(error.name!=="AbortError" && !this.signature)this.status.setText("Collection unavailable · reopen to retry");});
  }
  accept(badges) {
    const signature=badges.map(b=>b.id).join(",") || "empty";
    if(signature===this.signature)return;
    this.signature=signature;this.badges=[...badges].reverse();this.render();
  }
  render() {
    this.content.removeAll(true);
    const pages=Math.max(1,Math.ceil(this.badges.length/6));
    this.page=Phaser.Math.Clamp(this.page,0,pages-1);
    this.status.setText(this.badges.length ? `${this.badges.length} badges earned · every victory adds a new badge` : "Win a boss battle to earn your first badge!");
    this.pageLabel.setText(`${this.page+1} / ${pages}`);
    this.prev.setVisible(this.page>0);this.next.setVisible(this.page<pages-1);
    this.prev.getData("panel").setVisible(this.page>0);
    this.next.getData("panel").setVisible(this.page<pages-1);
    this.badges.slice(this.page*6,this.page*6+6).forEach((badge,i)=>{
      const x=28+(i%3)*250,y=105+Math.floor(i/3)*144;
      this.content.add(carePanel(this,x,y,244,134));
      const medal=createBadgeArt(this,x+122,y+35,badge,this.content,.94);
      medal.setSize(76,80).setInteractive({useHandCursor:true});
      medal.on("pointerover",()=>{
        this.tweens.killTweensOf(medal);
        this.tweens.add({targets:medal,scale:1.04,angle:-5,duration:180,ease:"Sine.easeOut"});
      });
      medal.on("pointerout",()=>{
        this.tweens.killTweensOf(medal);
        this.tweens.add({targets:medal,scale:.94,angle:0,duration:180});
      });
      this.content.add(this.label(x+122,y+78,badge.name,16,badge.color).setOrigin(0.5));
      const boss=badge.boss==="sporelings"?"Sporeling Trio":badge.boss==="chomper"?"Drought Chomper":"Boss victory";
      this.content.add(this.label(x+122,y+101,`#${badge.number} · ${boss}`,14).setOrigin(0.5));
      this.content.add(this.label(x+122,y+119,new Date(badge.earnedAt*1000).toLocaleDateString(),12,"#b8a7cf").setOrigin(0.5));
    });
  }
}
