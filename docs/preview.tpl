[[- Product card ]]
<article class="card">
  <h2 class="card__title">[[*pagetitle]]</h2>
  <p class="card__price">[[+price:default=`on request`]] [[++currency]]</p>

  [[$card.meta]]

  [[!pdoResources?
    &parents=`[[*id]]`
    &limit=`4`
    &tpl=`card.related`
  ]]

  <a href="[[~[[*id]]]]">[[%shop.read_more? &namespace=`shop`]]</a>
</article>
