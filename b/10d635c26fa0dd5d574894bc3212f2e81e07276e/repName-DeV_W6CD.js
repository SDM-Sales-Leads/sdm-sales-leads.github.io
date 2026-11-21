function r(n,t=""){const o=String(n||"").split("@")[0].trim().split(/[._\-+\s]+/).filter(e=>/^[a-zA-Z؀-ۿ]{2,}$/.test(e)).slice(0,2);return o.length?o.map(e=>e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join(" "):t}function c(n,t){if(!t)return n;const i=n.replace(/\s+$/,""),o=t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),e=i.split(`
`),s=e[e.length-1].trim();return s===t?i:new RegExp(`^${o}\\s*[—–-]\\s*(.+)$`).test(s)?(e[e.length-1]=s.replace(new RegExp(`^${o}\\s*[—–-]\\s*`),""),e.join(`
`)+`
`+t):i+`

`+t}const a=()=>{try{return window.matchMedia("(max-width: 767px)").matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)}catch{return!1}},l=(n,t)=>{const i=`https://wa.me/${n}?text=${encodeURIComponent(t)}`,o=`whatsapp://send?phone=${n}&text=${encodeURIComponent(t)}`;let e=!1;const s=()=>{document.hidden&&(e=!0)};document.addEventListener("visibilitychange",s),window.location.href=o,window.setTimeout(()=>{document.removeEventListener("visibilitychange",s),!e&&!document.hidden&&(window.location.href=i)},1500)};export{a as i,l as o,r,c as s};
