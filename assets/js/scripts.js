/**
 * Algorithme de Réception pour le Formulaire de Contact GestScolaire
 * Traite les données du formulaire, valide les informations et envoie les notifications
 */

class ContactReceptionAlgorithm {
    constructor() {
        this.emailConfig = {
            adminEmail: 'contact@gestscolaire.com',
            teamEmails: {
                'Traoré Seydou Bah': 'seydou@gestscolaire.com',
                'Maiga Boulkassoum': 'boulkassoum@gestscolaire.com',
                'Fané Moussa': 'moussa@gestscolaire.com'
            }
        };
        
        this.subjectCategories = {
            'Demande d\'information': 'INFO',
            'Demande de démonstration': 'DEMO',
            'Support technique': 'SUPPORT',
            'Partenariat': 'PARTNERSHIP',
            'Autre': 'OTHER'
        };
    }

    /**
     * Point d'entrée principal pour traiter une soumission de formulaire
     * @param {Object} formData - Données du formulaire
     * @returns {Object} Résultat du traitement
     */
    async processContactSubmission(formData) {
        try {
            // Étape 1: Validation des données
            const validationResult = this.validateFormData(formData);
            if (!validationResult.isValid) {
                return this.createResponse(false, 'Données invalides', validationResult.errors);
            }

            // Étape 2: Nettoyage et normalisation des données
            const cleanedData = this.sanitizeFormData(formData);

            // Étape 3: Classification et routage
            const routingInfo = this.routeMessage(cleanedData);

            // Étape 4: Génération des emails
            const emailTemplates = this.generateEmailTemplates(cleanedData, routingInfo);

            // Étape 5: Envoi des notifications
            const sendResults = await this.sendNotifications(emailTemplates);

            // Étape 6: Enregistrement dans la base de données
            const dbResult = await this.saveToDatabase(cleanedData, routingInfo);

            // Étape 7: Génération de la réponse
            return this.createResponse(true, 'Message envoyé avec succès', {
                ticketId: dbResult.ticketId,
                estimatedResponse: routingInfo.estimatedResponseTime
            });

        } catch (error) {
            console.error('Erreur lors du traitement:', error);
            return this.createResponse(false, 'Erreur serveur', { error: error.message });
        }
    }

    /**
     * Valide les données du formulaire
     * @param {Object} formData - Données à valider
     * @returns {Object} Résultat de validation
     */
    validateFormData(formData) {
        const errors = [];
        const required = ['nom', 'email', 'message'];

        // Vérification des champs obligatoires
        required.forEach(field => {
            if (!formData[field] || formData[field].trim() === '') {
                errors.push(`Le champ ${field} est obligatoire`);
            }
        });

        // Validation de l'email
        if (formData.email && !this.isValidEmail(formData.email)) {
            errors.push('Format d\'email invalide');
        }

        // Validation du téléphone (optionnel mais format requis si fourni)
        if (formData.telephone && !this.isValidPhone(formData.telephone)) {
            errors.push('Format de téléphone invalide');
        }

        // Validation de la longueur du message
        if (formData.message && formData.message.length > 2000) {
            errors.push('Le message ne peut pas dépasser 2000 caractères');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Nettoie et normalise les données du formulaire
     * @param {Object} formData - Données brutes
     * @returns {Object} Données nettoyées
     */
    sanitizeFormData(formData) {
        return {
            nom: this.sanitizeText(formData.nom),
            email: formData.email.toLowerCase().trim(),
            telephone: this.sanitizePhone(formData.telephone),
            sujet: formData.sujet || 'Autre',
            message: this.sanitizeText(formData.message),
            timestamp: new Date().toISOString(),
            ipAddress: formData.ipAddress || 'N/A',
            userAgent: formData.userAgent || 'N/A'
        };
    }

    /**
     * Détermine le routage du message selon le sujet
     * @param {Object} data - Données nettoyées
     * @returns {Object} Informations de routage
     */
    routeMessage(data) {
        const category = this.subjectCategories[data.sujet] || 'OTHER';
        
        let assignedTo = 'contact@gestscolaire.com';
        let priority = 'normal';
        let estimatedResponseTime = '24-48 heures';

        switch (category) {
            case 'SUPPORT':
                assignedTo = this.emailConfig.teamEmails['Fané Moussa'];
                priority = 'high';
                estimatedResponseTime = '2-4 heures';
                break;
            case 'DEMO':
                assignedTo = this.emailConfig.teamEmails['Traoré Seydou Bah'];
                priority = 'high';
                estimatedResponseTime = '4-8 heures';
                break;
            case 'PARTNERSHIP':
                assignedTo = this.emailConfig.teamEmails['Traoré Seydou Bah'];
                priority = 'medium';
                estimatedResponseTime = '12-24 heures';
                break;
            case 'INFO':
                assignedTo = this.emailConfig.teamEmails['Maiga Boulkassoum'];
                priority = 'normal';
                estimatedResponseTime = '24-48 heures';
                break;
        }

        return {
            category,
            assignedTo,
            priority,
            estimatedResponseTime,
            ticketId: this.generateTicketId(category)
        };
    }

    /**
     * Génère les templates d'email
     * @param {Object} data - Données du contact
     * @param {Object} routing - Informations de routage
     * @returns {Object} Templates d'email
     */
    generateEmailTemplates(data, routing) {
        // Email de confirmation à l'utilisateur
        const userConfirmation = {
            to: data.email,
            subject: `Confirmation de réception - Ticket #${routing.ticketId}`,
            template: 'user_confirmation',
            data: {
                nom: data.nom,
                ticketId: routing.ticketId,
                sujet: data.sujet,
                estimatedResponse: routing.estimatedResponseTime,
                message: data.message
            }
        };

        // Email de notification à l'équipe
        const teamNotification = {
            to: routing.assignedTo,
            cc: this.emailConfig.adminEmail,
            subject: `[${routing.priority.toUpperCase()}] Nouveau contact - ${data.sujet} - #${routing.ticketId}`,
            template: 'team_notification',
            data: {
                ticketId: routing.ticketId,
                category: routing.category,
                priority: routing.priority,
                contact: data,
                timestamp: data.timestamp
            }
        };

        return {
            userConfirmation,
            teamNotification
        };
    }

    /**
     * Simule l'envoi des notifications email
     * @param {Object} templates - Templates d'email
     * @returns {Object} Résultats d'envoi
     */
    async sendNotifications(templates) {
        const results = {};

        try {
            // Simulation d'envoi de l'email de confirmation utilisateur
            console.log('Envoi de confirmation à:', templates.userConfirmation.to);
            results.userConfirmation = await this.simulateEmailSend(templates.userConfirmation);

            // Simulation d'envoi de notification à l'équipe
            console.log('Envoi de notification à:', templates.teamNotification.to);
            results.teamNotification = await this.simulateEmailSend(templates.teamNotification);

            return {
                success: true,
                results: results
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Simule la sauvegarde en base de données
     * @param {Object} data - Données à sauvegarder
     * @param {Object} routing - Informations de routage
     * @returns {Object} Résultat de sauvegarde
     */
    async saveToDatabase(data, routing) {
        // Simulation de sauvegarde en base de données
        const dbRecord = {
            id: Date.now(),
            ticketId: routing.ticketId,
            status: 'nouveau',
            priority: routing.priority,
            assignedTo: routing.assignedTo,
            category: routing.category,
            contact: data,
            createdAt: data.timestamp,
            updatedAt: data.timestamp
        };

        console.log('Sauvegarde en base de données:', dbRecord);
        
        // Simulation d'un délai de base de données
        await new Promise(resolve => setTimeout(resolve, 100));

        return {
            success: true,
            ticketId: routing.ticketId,
            recordId: dbRecord.id
        };
    }

    /**
     * Fonctions utilitaires
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    isValidPhone(phone) {
        // Format malien: +223 XX XX XX XX
        const phoneRegex = /^(\+223\s?)?[0-9\s-]{8,12}$/;
        return phoneRegex.test(phone);
    }

    sanitizeText(text) {
        if (!text) return '';
        return text.trim().replace(/[<>]/g, '');
    }

    sanitizePhone(phone) {
        if (!phone) return '';
        return phone.replace(/[^\d+\s-]/g, '').trim();
    }

    generateTicketId(category) {
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.random().toString(36).substr(2, 3).toUpperCase();
        return `${category}-${timestamp}-${random}`;
    }

    simulateEmailSend(emailData) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    success: true,
                    messageId: 'msg_' + Date.now(),
                    timestamp: new Date().toISOString()
                });
            }, Math.random() * 1000 + 500);
        });
    }

    createResponse(success, message, data = null) {
        return {
            success,
            message,
            data,
            timestamp: new Date().toISOString()
        };
    }
}

// Exemple d'utilisation
const contactReception = new ContactReceptionAlgorithm();

// Fonction pour intégrer avec le formulaire HTML
async function handleContactFormSubmission(formElement) {
    const formData = new FormData(formElement);
    
    const contactData = {
        nom: formData.get('nom'),
        email: formData.get('email'),
        telephone: formData.get('telephone'),
        sujet: formData.get('sujet'),
        message: formData.get('message'),
        ipAddress: '192.168.1.1', // À récupérer côté serveur
        userAgent: navigator.userAgent
    };

    try {
        const result = await contactReception.processContactSubmission(contactData);
        
        if (result.success) {
            alert(`Message envoyé avec succès!\nTicket: ${result.data.ticketId}\nRéponse estimée: ${result.data.estimatedResponse}`);
            formElement.reset();
        } else {
            alert(`Erreur: ${result.message}`);
            console.error('Erreurs de validation:', result.data);
        }
    } catch (error) {
        alert('Erreur lors de l\'envoi du message. Veuillez réessayer.');
        console.error('Erreur:', error);
    }
}

// Export pour utilisation
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContactReceptionAlgorithm;
}

// Exemple de test
console.log('=== Test de l\'algorithme de réception ===');

const testData = {
    nom: 'Test Utilisateur',
    email: 'test@example.com',
    telephone: '+223 94 30 63 02',
    sujet: 'Support technique',
    message: 'J\'ai besoin d\'aide avec la configuration du système.',
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 Test Browser'
};

contactReception.processContactSubmission(testData)
    .then(result => {
        console.log('Résultat du test:', result);
    })
    .catch(error => {
        console.error('Erreur de test:', error);
    });