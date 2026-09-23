# Manoir de Procé — maquette locale

Reproduction statique (HTML/CSS/JS) du site www.manoirdeproce.fr, faite pour développer
un chatbot en local **sans toucher au site du client**.

## Lancer

Ouvrez `index.html` dans le navigateur, ou servez le dossier :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

## Structure

```
index.html              Accueil
cafe-restaurant.html    Café Restaurant
privatisation.html      Privatisation / réceptions
contact.html            Contact (formulaire factice)
assets/css/style.css    Styles du site
assets/js/main.js       Menu mobile
assets/img/             Photos à déposer (voir LISEZMOI.txt)
chatbot/chatbot.js      Widget chatbot — logique dans getBotReply()
chatbot/chatbot.css     Styles du widget
```

Le chatbot est chargé sur chaque page par deux lignes (`chatbot.css` dans le `<head>`,
`chatbot.js` avant `</body>`), comme il le serait sur le site WordPress final.

## Limites

Les textes viennent d'informations publiques (horaires, adresse, capacités) ; la mise en page
et les couleurs sont une approximation du site. Remplacez les photos et ajustez les textes si besoin.
