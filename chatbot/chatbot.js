/*
 * Chatbot — squelette de départ pour la maquette locale.
 * Toute la logique de réponse est dans getBotReply() : remplacez-la par
 * un appel à votre API (fetch vers votre backend) quand vous serez prêt.
 */
(function () {
  const WELCOME = "Bonjour ! Je suis l'assistant du Manoir de Procé. Posez-moi vos questions sur le café, le restaurant ou la privatisation.";

  // Réponses de démonstration par mots-clés (à remplacer).
  const FAQ = [
    { keys: ['horaire', 'heure', 'ouvert', 'ouverture'], answer: "Café : de 10h jusqu'à la fermeture du parc.\nRestaurant : du mardi au dimanche, 12h15 – 14h00." },
    { keys: ['adresse', 'où', 'venir', 'accès', 'trouver'], answer: "44 rue des Dervallières, 44000 Nantes, au cœur du parc de Procé." },
    { keys: ['réserv', 'reserv', 'téléphone', 'telephone', 'appeler'], answer: "Pour réserver, appelez le 02 51 86 47 23." },
    { keys: ['privatis', 'événement', 'evenement', 'mariage', 'anniversaire', 'salle', 'séminaire'], answer: "Le Manoir se privatise 7j/7 : 40 personnes assises (1 salle), 56 (2 salles), 80 en cocktail ou soirée dansante. Faites une demande de devis via la page Contact." },
    { keys: ['carte', 'menu', 'prix', 'tarif', 'manger'], answer: "La carte change chaque mois (produits frais, locaux et de saison). Formules déjeuner de 21 € à 25 €." },
    { keys: ['vin'], answer: "Nous proposons une sélection de vins bio, nature et biodynamiques." },
  ];

  async function getBotReply(message) {
    const m = message.toLowerCase();
    const hit = FAQ.find(f => f.keys.some(k => m.includes(k)));
    return hit ? hit.answer : "Je n'ai pas encore la réponse. Vous pouvez nous joindre au 02 51 86 47 23.";
    // Exemple d'appel backend :
    // const r = await fetch('http://localhost:3000/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    // return (await r.json()).reply;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function init() {
    const launcher = el('button', 'cb-launcher', '💬');
    launcher.setAttribute('aria-label', 'Ouvrir le chat');

    const panel = el('div', 'cb-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat du Manoir de Procé');
    const header = el('div', 'cb-header');
    header.append(el('strong', null, 'Manoir de Procé'));
    const close = el('button', 'cb-close', '×');
    close.setAttribute('aria-label', 'Fermer');
    header.append(close);

    const messages = el('div', 'cb-messages');
    const form = el('form', 'cb-form');
    const input = el('input');
    input.placeholder = 'Votre question…';
    input.setAttribute('aria-label', 'Votre question');
    form.append(input, el('button', null, 'Envoyer'));
    panel.append(header, messages, form);
    document.body.append(panel, launcher);

    const add = (text, who) => {
      messages.append(el('div', 'cb-msg ' + who, text));
      messages.scrollTop = messages.scrollHeight;
    };

    const toggle = () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        if (!messages.children.length) add(WELCOME, 'bot');
        input.focus();
      }
    };
    launcher.addEventListener('click', toggle);
    close.addEventListener('click', toggle);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      add(text, 'user');
      input.value = '';
      try {
        add(await getBotReply(text), 'bot');
      } catch (err) {
        add("Désolé, une erreur est survenue.", 'bot');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
