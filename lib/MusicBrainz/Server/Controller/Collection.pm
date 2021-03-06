package MusicBrainz::Server::Controller::Collection;
use Moose;
use Scalar::Util qw( looks_like_number );

BEGIN { extends 'MusicBrainz::Server::Controller' };

with 'MusicBrainz::Server::Controller::Role::Load' => {
    entity_name => 'collection',
    model       => 'Collection',
};
with 'MusicBrainz::Server::Controller::Role::Subscribe';

use MusicBrainz::Server::Data::Utils qw( model_to_type type_to_model load_everything_for_edits );
use MusicBrainz::Server::Constants qw( :edit_status entities_with );

sub base : Chained('/') PathPart('collection') CaptureArgs(0) { }

after 'load' => sub {
    my ($self, $c) = @_;
    my $collection = $c->stash->{collection};

    if ($c->user_exists) {
        $c->stash->{subscribed} = $c->model('Collection')->subscription->check_subscription(
            $c->user->id, $collection->id);
    }

    # Load editor
    $c->model('Editor')->load($collection);
    $c->model('CollectionType')->load($collection);

    $c->stash(
        my_collection => $c->user_exists && $c->user->id == $collection->editor_id
    )
};

sub own_collection : Chained('load') CaptureArgs(0) {
    my ($self, $c) = @_;

    my $collection = $c->stash->{collection};
    $c->forward('/user/do_login') if !$c->user_exists;
    $c->detach('/error_403') if $c->user->id != $collection->editor_id;
}

sub _do_add_or_remove {
    my ($self, $c, $func_name) = @_;

    my $collection = $c->stash->{collection};
    my $entity_type = $collection->type->entity_type;
    my $entity_id = $c->request->params->{$entity_type};

    if ($entity_id) {
        my $entity = $c->model(type_to_model($entity_type))->get_by_id($entity_id);

        $c->model('Collection')->$func_name($entity_type, $collection->id, $entity_id);

        $c->response->redirect($c->req->referer || $c->uri_for_action("/$entity_type/show", [ $entity->gid ]));
        $c->detach;
    } else {
        $c->forward('show');
    }
}

sub add : Chained('own_collection') RequireAuth {
    my ($self, $c) = @_;
    $self->_do_add_or_remove($c, 'add_entities_to_collection');
}

sub remove : Chained('own_collection') RequireAuth {
    my ($self, $c) = @_;
    $self->_do_add_or_remove($c, 'remove_entities_from_collection');
}

sub show : Chained('load') PathPart('') {
    my ($self, $c) = @_;

    my $collection = $c->stash->{collection};
    my $entity_type = $collection->type->entity_type;

    if ($c->form_posted && $c->stash->{my_collection}) {
        my $remove_params = $c->req->params->{remove};
        $c->model('Collection')->remove_entities_from_collection($entity_type,
            $collection->id,
            grep { looks_like_number($_) }
                ref($remove_params) ? @$remove_params : ($remove_params)
        );
    }

    $self->own_collection($c) if !$collection->public;

    my $order = $c->req->params->{order} || 'date';

    my $model = $c->model(type_to_model($entity_type));
    my $entities = $self->_load_paged($c, sub {
            $model->find_by_collection($collection->id, shift, shift, $order);
    });

    if ($entity_type eq 'release') {
        $model->load_related_info(@$entities);
        $c->model('ArtistCredit')->load(@$entities);
        $c->model('ReleaseGroup')->load(@$entities);
        $c->model('ReleaseGroup')->load_meta(map { $_->release_group } @$entities);
        if ($c->user_exists) {
            $c->model('ReleaseGroup')->rating->load_user_ratings($c->user->id, map { $_->release_group } @$entities);
        }
    } elsif ($entity_type eq 'event') {
        $c->model('EventType')->load(@$entities);
        $model->load_performers(@$entities);
        $model->load_locations(@$entities);
        if ($c->user_exists) {
            $model->rating->load_user_ratings($c->user->id, @$entities);
        }
    }

    $c->stash(
        entities => $entities,
        collection => $collection,
        order => $order,
        template => 'collection/index.tt'
    );
}

sub edits : Chained('load') PathPart RequireAuth {
    my ($self, $c) = @_;
    $self->_list_edits($c);
}

sub open_edits : Chained('load') PathPart RequireAuth {
    my ($self, $c) = @_;
    $self->_list_edits($c, $STATUS_OPEN);
}

sub _list_edits {
    my ($self, $c, $status) = @_;

    $self->own_collection($c) if !$c->stash->{collection}->public;

    my $edits  = $self->_load_paged($c, sub {
        my ($limit, $offset) = @_;
        $c->model('Edit')->find_by_collection($c->stash->{collection}->id, $limit, $offset, $status);
    });

    $c->stash(  # stash early in case an ISE occurs while loading the edits
        template => 'entity/edits.tt',
        edits => $edits,
        all_edits => defined $status ? 0 : 1,
    );

    load_everything_for_edits($c, $edits);
}

sub _form_to_hash {
    my ($self, $form) = @_;
    return map { $form->field($_)->name => $form->field($_)->value } $form->edit_field_names;
}

sub _redirect_to_collection {
    my ($self, $c, $gid) = @_;
    $c->response->redirect($c->uri_for_action($self->action_for('show'), [ $gid ]));
}

sub create : Local RequireAuth {
    my ($self, $c) = @_;

    my $form = $c->form( form => 'Collection' );

    if ($c->form_posted && $form->submitted_and_valid($c->req->params)) {
        my %insert = $self->_form_to_hash($form);

        my $collection = $c->model('Collection')->insert($c->user->id, \%insert);
        for (entities_with('collections')) {
            my $entity_id = $c->request->params->{$_};

            if ($entity_id) {
              $c->model('Collection')->add_entities_to_collection($_, $collection->{id}, $entity_id);
            }
        }
        $self->_redirect_to_collection($c, $collection->{gid});
    }
}

sub edit : Chained('own_collection') RequireAuth {
    my ($self, $c) = @_;

    my $collection = $c->stash->{collection};

    my $form = $c->form( form => 'Collection', init_object => $collection );

    $c->model('Collection')->load_entity_count($collection);

    if ($c->form_posted && $form->submitted_and_valid($c->req->params)) {
        my %update = $self->_form_to_hash($form);

        $c->model('Collection')->update($collection->id, \%update);
        $self->_redirect_to_collection($c, $collection->gid);
    }
}

sub delete : Chained('own_collection') RequireAuth {
    my ($self, $c) = @_;

    my $collection = $c->stash->{collection};

    if ($c->form_posted) {
        $c->model('Collection')->delete($collection->id);

        $c->response->redirect(
            $c->uri_for_action('/user/collections', [ $c->user->name ]));
    }
}

1;

=head1 COPYRIGHT

Copyright (C) 2009 Lukas Lalinsky
Copyright (C) 2010 Sean Burke

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.

=cut
