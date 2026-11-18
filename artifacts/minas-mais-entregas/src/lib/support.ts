/**
 * Suporte via WhatsApp. A mensagem é só preenchida: quem envia é a própria pessoa.
 * Não inclua dados pessoais aqui.
 */
export const SUPPORT_WHATSAPP_NUMBER = "5535998782266";
export const SUPPORT_WHATSAPP_DISPLAY = "+55 35 99878-2266";
export const SUPPORT_MESSAGE = "Olá! Preciso de suporte no Sistema de Entregas Minas Mais.";

/**
 * Link universal do WhatsApp: no celular abre o app (ou a página web, se não estiver
 * instalado); no computador oferece o WhatsApp Web ou o app de desktop.
 */
export const supportWhatsAppUrl = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;
